import re
import sqlite3
from pathlib import Path
from typing import cast

from flask import current_app
from sqlalchemy import CheckConstraint, Column, Engine, create_engine, event, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import UnaryExpression

from .models import Base


class SchemaMismatch(Exception):
    pass


def make_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    if url.drivername != "sqlite":
        raise ValueError("ROOMSHELF_DATABASE_URL must use sqlite:///.")
    engine = create_engine(
        database_url,
        connect_args={"autocommit": False, "check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(connection: sqlite3.Connection, _record: object) -> None:
        previous = connection.autocommit
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.execute("PRAGMA busy_timeout = 5000")
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.close()
        finally:
            connection.autocommit = previous

    return engine


def get_engine() -> Engine:
    return cast(Engine, current_app.extensions["roomshelf_engine"])


def _canonical_check(expression: str) -> str:
    return re.sub(
        r"'(?:''|[^'])*'|\s+",
        lambda match: match.group(0) if match.group(0).startswith("'") else "",
        expression,
    )


def _check_existing_tables(engine: Engine, require_all: bool) -> None:
    inspector = inspect(engine)
    present = set(inspector.get_table_names())
    for name, table in Base.metadata.tables.items():
        if name not in present:
            if require_all:
                raise SchemaMismatch(f"Missing table {name}. Run flask --app roomshelf init-db.")
            continue
        actual = {column["name"]: column for column in inspector.get_columns(name)}
        expected = {column.name: column for column in table.columns}
        compatible = set(actual) == set(expected)
        for column_name, column in expected.items():
            found = actual.get(column_name)
            if found is None:
                continue
            compatible = compatible and (
                str(found["type"]).upper() == str(column.type).upper()
                and found["nullable"] == column.nullable
            )
        compatible = compatible and inspector.get_pk_constraint(name)[
            "constrained_columns"
        ] == list(table.primary_key.columns.keys())
        expected_checks = {
            str(constraint.name): _canonical_check(str(constraint.sqltext))
            for constraint in table.constraints
            if isinstance(constraint, CheckConstraint)
        }
        actual_checks = {
            str(constraint["name"]): _canonical_check(constraint["sqltext"])
            for constraint in inspector.get_check_constraints(name)
        }
        compatible = compatible and all(
            actual_checks.get(check_name) == expression
            for check_name, expression in expected_checks.items()
        )
        if name == "products":
            compatible = compatible and any(
                constraint["column_names"] == ["slug"]
                for constraint in inspector.get_unique_constraints(name)
            )
        if name == "shortlist_items":
            actual_foreign_keys = inspector.get_foreign_keys(name)
            for expected_fk in table.foreign_key_constraints:
                compatible = compatible and any(
                    foreign_key["constrained_columns"] == list(expected_fk.column_keys)
                    and foreign_key["referred_table"]
                    == next(iter(expected_fk.elements)).column.table.name
                    and foreign_key["referred_columns"]
                    == [element.column.name for element in expected_fk.elements]
                    and foreign_key["options"].get("ondelete") == "CASCADE"
                    and foreign_key["options"].get("onupdate") == "RESTRICT"
                    for foreign_key in actual_foreign_keys
                )
        expected_indexes = {index.name for index in table.indexes}
        actual_indexes = {index["name"] for index in inspector.get_indexes(name)}
        compatible = compatible and expected_indexes <= actual_indexes
        with engine.connect() as connection:
            for index in table.indexes:
                expected_index: list[tuple[str, bool]] = []
                for expression in index.expressions:
                    if isinstance(expression, Column):
                        expected_index.append((expression.name, False))
                    elif isinstance(expression, UnaryExpression):
                        expected_index.append(
                            (expression.element.name, expression.modifier is operators.desc_op)
                        )
                quoted_name = engine.dialect.identifier_preparer.quote(str(index.name))
                index_rows = connection.exec_driver_sql(f"PRAGMA index_xinfo({quoted_name})").all()
                actual_index = [
                    (row[2], bool(row[3])) for row in index_rows if row[5] and row[1] >= 0
                ]
                compatible = compatible and expected_index == actual_index
        if not compatible:
            raise SchemaMismatch(
                f"Table {name} has an incompatible schema. Use an explicit migration; "
                "initialization will not alter existing tables."
            )


def check_schema(engine: Engine) -> None:
    _check_existing_tables(engine, require_all=True)


def initialize_database(engine: Engine) -> None:
    database = engine.url.database
    if database and database != ":memory:":
        Path(database).resolve().parent.mkdir(parents=True, exist_ok=True)
    _check_existing_tables(engine, require_all=False)
    Base.metadata.create_all(engine)
    check_schema(engine)
