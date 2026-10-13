import click
from flask import Flask
from sqlalchemy.exc import SQLAlchemyError

from .db import SchemaMismatch, get_engine, initialize_database
from .seed import SeedConflict, seed_database


def register_commands(app: Flask) -> None:
    @app.cli.command("init-db")
    def init_db() -> None:
        """Create missing tables without replacing existing data."""
        try:
            initialize_database(get_engine())
        except (SchemaMismatch, SQLAlchemyError) as error:
            raise click.ClickException(str(error)) from error
        click.echo("Database initialized; existing data preserved.")

    @app.cli.command("seed")
    @click.option("--reset", is_flag=True, help="Replace all products and their saved memberships.")
    def seed(reset: bool) -> None:
        """Insert missing fictional products using the fixed seed 2026."""
        try:
            inserted = seed_database(get_engine(), reset=reset)
        except (SchemaMismatch, SeedConflict, SQLAlchemyError) as error:
            raise click.ClickException(str(error)) from error
        click.echo(f"Inserted {inserted} products (seed 2026).")
