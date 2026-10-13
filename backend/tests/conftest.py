from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from roomshelf import create_app
from roomshelf.db import initialize_database
from roomshelf.models import Product


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Flask]:
    application = create_app(
        {"TESTING": True, "DATABASE_URL": f"sqlite:///{tmp_path / 'catalog.sqlite3'}"}
    )
    engine: Engine = application.extensions["roomshelf_engine"]
    initialize_database(engine)
    yield application
    engine.dispose()


@pytest.fixture
def engine(app: Flask) -> Engine:
    return app.extensions["roomshelf_engine"]


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture
def add_product(engine: Engine) -> Callable[..., Product]:
    def add(**overrides: Any) -> Product:
        values = {
            "id": 1,
            "slug": "sample-chair-001",
            "title": "Sample Chair",
            "category": "chair",
            "material": "wood",
            "color": "natural",
            "description": "A compact chair for a quiet corner.",
            "price_jpy": 100,
            "width_cm": 50,
            "depth_cm": 40,
            "height_cm": 80,
            "availability": "in_stock",
            "illustration_key": "chair-01",
            "display_order": 1,
        }
        values.update(overrides)
        product = Product(**values)
        with Session(engine, expire_on_commit=False) as session, session.begin():
            session.add(product)
        return product

    return add


@pytest.fixture
def sample_products(add_product: Callable[..., Product]) -> list[Product]:
    return [
        add_product(
            id=1,
            slug="kuru-chair-001",
            title="ＫＵＲＵ Chair",
            description="Straße 100%_literal / quiet corner; shelf\\slot.",
            display_order=2,
        ),
        add_product(
            id=2,
            slug="beta-table-002",
            title="Beta Table",
            description="A broad table for a quiet corner.",
            category="table",
            material="metal",
            illustration_key="table-01",
            price_jpy=200,
            width_cm=80,
        ),
        add_product(
            id=3,
            slug="alpha-chair-003",
            title="Alpha Chair",
            material="metal",
            display_order=2,
        ),
        add_product(
            id=4,
            slug="delta-sofa-004",
            title="delta sofa",
            description="A soft sofa for a quiet corner.",
            category="sofa",
            material="fabric",
            illustration_key="sofa-01",
            price_jpy=300,
            width_cm=100,
            display_order=4,
        ),
        add_product(
            id=5,
            slug="cafe-desk-005",
            title="Café Desk",
            description="A compact desk for a quiet corner.",
            category="desk",
            illustration_key="desk-01",
            price_jpy=200,
            width_cm=80,
            display_order=3,
        ),
    ]
