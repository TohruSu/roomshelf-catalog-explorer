from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateIndex, CreateTable

from roomshelf import create_app
from roomshelf.db import SchemaMismatch, initialize_database
from roomshelf.models import AnonymousShortlist, Product, ShortlistItem
from roomshelf.normalization import normalize_text
from roomshelf.seed import SeedConflict, seed_database, seed_records


def rows(engine: Engine) -> list[dict[str, Any]]:
    with engine.connect() as connection:
        return [
            dict(row) for row in connection.execute(select(Product).order_by(Product.id)).mappings()
        ]


def test_seed_is_exact_and_repeatable_across_databases(engine: Engine, tmp_path: Path) -> None:
    second = create_app({"DATABASE_URL": f"sqlite:///{tmp_path / 'second.sqlite3'}"})
    second_engine: Engine = second.extensions["roomshelf_engine"]
    try:
        initialize_database(second_engine)
        assert seed_database(engine) == 144
        assert seed_database(second_engine) == 144
        assert rows(engine) == rows(second_engine) == seed_records()
        assert len({row["slug"] for row in rows(engine)}) == 144
        assert {row["illustration_key"] for row in rows(engine)} == {
            "bed-01",
            "chair-01",
            "desk-01",
            "sofa-01",
            "storage-01",
            "table-01",
        }
    finally:
        second_engine.dispose()


def test_init_and_seed_preserve_edits_and_extra_rows(
    engine: Engine, add_product: Callable[..., Product]
) -> None:
    seed_database(engine)
    with Session(engine) as session, session.begin():
        product = session.get(Product, 1)
        assert product is not None
        product.title = "An edited title"
        product.price_jpy = 12345
        missing = session.get(Product, 2)
        assert missing is not None
        session.delete(missing)
    add_product(id=1000, slug="extra-chair-1000")
    initialize_database(engine)
    assert seed_database(engine) == 1
    assert seed_database(engine) == 0
    with Session(engine) as session:
        preserved = session.get(Product, 1)
        assert preserved is not None
        assert preserved.title == "An edited title"
        assert preserved.price_jpy == 12345
        assert session.get(Product, 1000) is not None
    assert len(rows(engine)) == 145


@pytest.mark.parametrize("collision", ["id", "slug"])
def test_seed_identity_conflict_aborts_without_partial_changes(
    engine: Engine, add_product: Callable[..., Product], collision: str
) -> None:
    record = seed_records()[30]
    if collision == "id":
        add_product(id=record["id"], slug="different-chair-031")
    else:
        add_product(id=1000, slug=record["slug"])
    before = rows(engine)
    with pytest.raises(SeedConflict, match="identity conflict"):
        seed_database(engine)
    assert rows(engine) == before


def test_explicit_reset_replaces_catalog_and_cascades_memberships(engine: Engine) -> None:
    seed_database(engine)
    key = "a" * 64
    with Session(engine) as session, session.begin():
        session.add(
            AnonymousShortlist(
                key=key,
                created_at="2026-01-01T00:00:00.000000Z",
                updated_at="2026-01-01T00:00:00.000000Z",
                expires_at="2026-02-01T00:00:00.000000Z",
            )
        )
        session.flush()
        session.add(ShortlistItem(shortlist_key=key, product_id=1, added_at="2026-01-01T00:00:00Z"))
        product = session.get(Product, 1)
        assert product is not None
        product.title = "Edited title"
    assert seed_database(engine, reset=True) == 144
    assert rows(engine) == seed_records()
    with Session(engine) as session:
        assert session.get(AnonymousShortlist, key) is not None
        assert list(session.scalars(select(ShortlistItem))) == []


def test_orm_edits_update_normalized_fields(
    engine: Engine, add_product: Callable[..., Product]
) -> None:
    add_product(title="ＦＯＬＤ", description=" Straße  \n Corner ")
    with Session(engine) as session, session.begin():
        product = session.get(Product, 1)
        assert product is not None
        assert product.title_sort_key == "fold"
        assert product.search_text == "fold strasse corner"
        product.title = "  ＫＵＲＵ "
        product.description = "QUIET\tRoom"
    with Session(engine) as session:
        updated = session.get(Product, 1)
        assert updated is not None
        assert updated.title_sort_key == "kuru"
        assert updated.search_text == normalize_text("  ＫＵＲＵ  QUIET\tRoom")


@pytest.mark.parametrize(
    "overrides",
    [
        {"price_jpy": -1},
        {"price_jpy": 2147483648},
        {"price_jpy": 1.5},
        {"width_cm": 0},
        {"depth_cm": 1001},
        {"height_cm": 2.5},
        {"category": "unknown"},
        {"material": "unknown"},
        {"availability": "unknown"},
        {"illustration_key": "https://example.invalid/image.svg"},
        {"title": "   "},
    ],
)
def test_product_database_constraints(
    add_product: Callable[..., Product], overrides: dict[str, Any]
) -> None:
    with pytest.raises(IntegrityError):
        add_product(**overrides)


def test_slug_uniqueness_and_foreign_key_enforcement(
    engine: Engine, add_product: Callable[..., Product]
) -> None:
    add_product()
    with pytest.raises(IntegrityError):
        add_product(id=2)
    with Session(engine) as session, session.begin(), pytest.raises(IntegrityError):
        session.add(ShortlistItem(shortlist_key="f" * 64, product_id=1, added_at="2026-01-01"))
        session.flush()
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
        assert connection.connection.driver_connection.autocommit is False


def test_incompatible_initialization_is_refused_without_alteration(tmp_path: Path) -> None:
    app = create_app({"DATABASE_URL": f"sqlite:///{tmp_path / 'old.sqlite3'}"})
    engine: Engine = app.extensions["roomshelf_engine"]
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT)"))
            connection.execute(text("INSERT INTO products VALUES (1, 'Existing object')"))
        with pytest.raises(SchemaMismatch, match="explicit migration"):
            initialize_database(engine)
        assert inspect(engine).get_table_names() == ["products"]
        with engine.connect() as connection:
            assert (
                connection.execute(text("SELECT title FROM products")).scalar_one()
                == "Existing object"
            )
    finally:
        engine.dispose()


def test_changed_named_check_is_incompatible(engine: Engine) -> None:
    table_sql = str(CreateTable(Product.__table__).compile(engine))
    weakened_sql = table_sql.replace(
        "typeof(price_jpy) = 'integer' AND price_jpy BETWEEN 0 AND 2147483647",
        "price_jpy >= 0",
    )
    assert weakened_sql != table_sql
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE products")
        connection.exec_driver_sql(weakened_sql)
        for index in Product.__table__.indexes:
            connection.execute(CreateIndex(index))
    with pytest.raises(SchemaMismatch, match="explicit migration"):
        initialize_database(engine)


def test_changed_named_index_is_incompatible(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP INDEX ix_products_price_id")
        connection.exec_driver_sql("CREATE INDEX ix_products_price_id ON products (width_cm, id)")
    with pytest.raises(SchemaMismatch, match="explicit migration"):
        initialize_database(engine)


def test_cli_init_and_seed_are_explicit_and_idempotent(app: Flask) -> None:
    runner = app.test_cli_runner()
    assert runner.invoke(args=["init-db"]).exit_code == 0
    first = runner.invoke(args=["seed"])
    assert first.exit_code == 0
    assert "Inserted 144" in first.output
    second = runner.invoke(args=["seed"])
    assert second.exit_code == 0
    assert "Inserted 0" in second.output
