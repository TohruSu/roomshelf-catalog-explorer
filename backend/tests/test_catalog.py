from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from flask.testing import FlaskClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from roomshelf import create_app
from roomshelf.models import Product
from roomshelf.seed import seed_database


def ids(response: Any) -> list[int]:
    return [product["id"] for product in response.json["data"]]


def test_health_reads_initialized_schema(client: FlaskClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json == {"data": {"status": "ok", "database": "ok"}}


def test_health_reports_uninitialized_database(tmp_path: Path) -> None:
    app = create_app({"TESTING": True, "DATABASE_URL": f"sqlite:///{tmp_path / 'empty.sqlite3'}"})
    try:
        response = app.test_client().get("/api/health")
        assert response.status_code == 503
        assert response.json["error"]["code"] == "database_unavailable"
    finally:
        app.extensions["roomshelf_engine"].dispose()


def test_empty_filters(client: FlaskClient) -> None:
    assert client.get("/api/filters").json == {
        "data": {
            "categories": [],
            "materials": [],
            "price_jpy": {"min": None, "max": None},
            "dimensions_cm": {
                dimension: {"min": None, "max": None} for dimension in ("width", "depth", "height")
            },
        }
    }


def test_filters_are_global_sorted_and_exact(
    client: FlaskClient, sample_products: list[Product]
) -> None:
    assert client.get("/api/filters").json == {
        "data": {
            "categories": ["chair", "desk", "sofa", "table"],
            "materials": ["fabric", "metal", "wood"],
            "price_jpy": {"min": 100, "max": 300},
            "dimensions_cm": {
                "width": {"min": 50, "max": 100},
                "depth": {"min": 40, "max": 40},
                "height": {"min": 80, "max": 80},
            },
        }
    }


def test_facets_or_within_and_across_inclusive_bounds(
    client: FlaskClient, sample_products: list[Product]
) -> None:
    response = client.get(
        "/api/products?category=chair&category=table&category=chair"
        "&material=wood&material=metal&min_price=100&max_price=200&max_width=80"
    )
    assert response.status_code == 200
    assert ids(response) == [2, 1, 3]
    assert response.json["meta"]["total"] == 3
    assert ids(client.get("/api/products?category=chair&material=metal")) == [3]
    assert ids(client.get("/api/products?min_price=100&max_price=100&max_width=50")) == [1, 3]
    assert ids(client.get("/api/products?category=sofa&max_width=99")) == []


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("ＫＵＲＵ", [1]),
        ("kuru", [1]),
        ("STRASSE", [1]),
        ("chair corner", [1, 3]),
        ("table corner", [2]),
        ("chair strasse", [1]),
        ("100%_literal", [1]),
        ("%", [1]),
        ("_", [1]),
        ("\\", [1]),
        ("/", [1]),
        ("shelf\\slot.", [1]),
        ("%' OR 1=1 --", []),
        ("café", [5]),
        ("cafe", []),
        ("   \t  ", [2, 1, 3, 5, 4]),
    ],
)
def test_normalized_literal_and_term_search(
    client: FlaskClient, sample_products: list[Product], query: str, expected: list[int]
) -> None:
    response = client.get("/api/products", query_string={"q": query})
    assert response.status_code == 200
    assert ids(response) == expected


def test_search_only_title_and_description(
    client: FlaskClient, add_product: Callable[..., Product]
) -> None:
    add_product(title="An Object", description="A quiet object.", material="glass")
    assert ids(client.get("/api/products?q=glass")) == []


@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        ("featured", [2, 1, 3, 5, 4]),
        ("price_asc", [1, 3, 2, 5, 4]),
        ("price_desc", [4, 2, 5, 1, 3]),
        ("title_asc", [3, 2, 5, 4, 1]),
    ],
)
def test_exact_sort_and_id_ties(
    client: FlaskClient, sample_products: list[Product], sort: str, expected: list[int]
) -> None:
    for _ in range(2):
        assert ids(client.get("/api/products", query_string={"sort": sort})) == expected
    traversed = []
    for page in range(1, 4):
        response = client.get(
            "/api/products", query_string={"sort": sort, "page": page, "page_size": 2}
        )
        traversed.extend(ids(response))
    assert traversed == expected


def test_title_sort_normalization_tie_uses_id(
    client: FlaskClient, add_product: Callable[..., Product]
) -> None:
    add_product(id=2, slug="chair-002", title="ＦＯＬＤ CHAIR")
    add_product(id=1, title="fold chair")
    assert ids(client.get("/api/products?sort=title_asc")) == [1, 2]


def test_sql_pagination_and_summary_contract(client: FlaskClient, engine: Engine) -> None:
    seed_database(engine)
    default = client.get("/api/products")
    assert len(default.json["data"]) == 12
    assert default.json["meta"] == {"page": 1, "page_size": 12, "total": 144, "total_pages": 12}
    assert set(default.json["data"][0]) == {
        "id",
        "slug",
        "title",
        "category",
        "material",
        "color",
        "price_jpy",
        "dimensions_cm",
        "availability",
        "illustration_key",
    }
    assert set(default.json["data"][0]["dimensions_cm"]) == {"width", "depth", "height"}
    assert len(client.get("/api/products?page_size=48").json["data"]) == 48
    partial = client.get("/api/products?page_size=47&page=4")
    assert len(partial.json["data"]) == 3
    assert partial.json["meta"] == {"page": 4, "page_size": 47, "total": 144, "total_pages": 4}
    beyond = client.get("/api/products?page=10000")
    assert beyond.json["data"] == []
    assert beyond.json["meta"]["total"] == 144
    assert beyond.json["meta"]["page"] == 10000
    empty = client.get("/api/products?q=absentword")
    assert empty.json == {
        "data": [],
        "meta": {"page": 1, "page_size": 12, "total": 0, "total_pages": 0},
    }
    assert client.get("/api/products?page=0001&page_size=00012").json == default.json


@pytest.mark.parametrize(
    "query",
    [
        "page=0",
        "page=10001",
        "page=-1",
        "page=1.0",
        "page=1e2",
        "page=+1",
        "page=%201",
        "page=１２",
        "page=",
        "page=1&page=1",
        "page_size=0",
        "page_size=49",
        "min_price=-1",
        "min_price=2147483648",
        "min_price=100&max_price=99",
        "max_price=",
        "max_width=0",
        "max_width=1001",
        "category=unknown",
        "material=unknown",
        "category=",
        "sort=price",
        "sort=featured&sort=featured",
        "q=x&q=x",
        "color=natural",
        "unknown=x",
        "q=" + "x" * 101,
        "q=" + "+".join(["a"] * 9),
        "page=" + "9" * 5000,
    ],
)
def test_invalid_query_is_400_envelope(client: FlaskClient, query: str) -> None:
    response = client.get("/api/products?" + query)
    assert response.status_code == 400
    assert set(response.json) == {"error"}
    assert set(response.json["error"]) == {"code", "message", "details"}
    assert response.json["error"]["code"] == "invalid_request"
    assert response.json["error"]["details"]


def test_search_length_measured_after_casefold(client: FlaskClient) -> None:
    assert client.get("/api/products", query_string={"q": "ß" * 51}).status_code == 400
    assert client.get("/api/products", query_string={"q": "ß" * 50}).status_code == 200


@pytest.mark.parametrize("path", ["/api/health", "/api/filters"])
def test_no_query_endpoints_validate(client: FlaskClient, path: str) -> None:
    assert client.get(path + "?unexpected=1").status_code == 400


def test_get_bodies_and_framework_errors_use_envelope(client: FlaskClient) -> None:
    assert client.get("/api/products", data="body").json["error"]["code"] == "invalid_request"
    assert client.get("/api/products", data="x" * 4097).status_code == 413
    assert client.get("/api/absent").json["error"]["code"] == "route_not_found"
    wrong_method = client.post("/api/products")
    assert wrong_method.json["error"]["code"] == "method_not_allowed"
    assert "GET" in wrong_method.headers["Allow"]


@pytest.mark.parametrize("path", ["/api/session", "/api/shortlist", "/api/products/some-chair"])
def test_future_endpoints_absent(client: FlaskClient, path: str) -> None:
    assert client.get(path).status_code == 404


def test_database_failure_has_no_sensitive_details(tmp_path: Path) -> None:
    app = create_app(
        {"TESTING": True, "DATABASE_URL": f"sqlite:///{tmp_path / 'missing' / 'db.sqlite3'}"}
    )
    try:
        response = app.test_client().get("/api/products")
        assert response.status_code == 503
        assert response.json == {
            "error": {
                "code": "database_unavailable",
                "message": "Database is unavailable.",
                "details": [],
            }
        }
        assert str(tmp_path) not in response.get_data(as_text=True)
    finally:
        app.extensions["roomshelf_engine"].dispose()


def test_count_and_page_share_snapshot_during_committed_write(
    client: FlaskClient, engine: Engine, sample_products: list[Product]
) -> None:
    count_seen = False
    inserted = False

    def write_between_reads(
        connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        nonlocal count_seen, inserted
        if "SELECT count(" in statement:
            count_seen = True
        elif count_seen and "FROM products" in statement and not inserted:
            inserted = True
            with Session(engine) as writer, writer.begin():
                writer.add(
                    Product(
                        id=6,
                        slug="new-chair-006",
                        title="New Chair",
                        category="chair",
                        material="wood",
                        color="natural",
                        description="A newly inserted chair.",
                        price_jpy=150,
                        width_cm=50,
                        depth_cm=40,
                        height_cm=80,
                        availability="in_stock",
                        illustration_key="chair-01",
                        display_order=0,
                    )
                )

    event.listen(engine, "before_cursor_execute", write_between_reads)
    try:
        response = client.get("/api/products?page_size=48")
    finally:
        event.remove(engine, "before_cursor_execute", write_between_reads)
    assert inserted
    assert response.status_code == 200
    assert response.json["meta"]["total"] == 5
    assert ids(response) == [2, 1, 3, 5, 4]
    with Session(engine) as session:
        assert session.get(Product, 6) is not None
    assert client.get("/api/products?page_size=48").json["meta"]["total"] == 6


def test_reads_leave_database_unchanged(client: FlaskClient, engine: Engine) -> None:
    seed_database(engine)
    with Session(engine) as session:
        before = list(session.execute(select(Product.id, Product.slug, Product.search_text)))
    for path in ("/api/health", "/api/filters", "/api/products?page=2&sort=price_desc"):
        response = client.get(path)
        assert response.status_code == 200
        assert "Set-Cookie" not in response.headers
        assert response.headers["X-Content-Type-Options"] == "nosniff"
    with Session(engine) as session:
        assert (
            list(session.execute(select(Product.id, Product.slug, Product.search_text))) == before
        )
