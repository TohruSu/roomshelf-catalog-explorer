from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine, event, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from roomshelf import create_app
from roomshelf.models import AnonymousShortlist, Product, ShortlistItem
from roomshelf.security import _development_secret, timestamp

ORIGIN = "http://localhost:5173"
SECRET = "test-only-key-not-for-deployment-0123456789"


@pytest.fixture
def clock(app: Flask) -> list[datetime]:
    value = [datetime(2026, 10, 14, 12, tzinfo=UTC)]
    app.config["ROOMSHELF_CLOCK"] = lambda: value[0]
    return value


def bootstrap(client: FlaskClient) -> dict[str, Any]:
    response = client.get("/api/session")
    assert response.status_code == 200
    return response.json["data"]


def headers(data: dict[str, Any], **overrides: str) -> dict[str, str]:
    return {"Origin": ORIGIN, "X-CSRF-Token": data["csrf_token"], **overrides}


def state(engine: Engine) -> tuple[list[Any], list[Any]]:
    with Session(engine) as database:
        return (
            list(database.execute(select(AnonymousShortlist.key, AnonymousShortlist.updated_at))),
            list(
                database.execute(
                    select(
                        ShortlistItem.shortlist_key,
                        ShortlistItem.product_id,
                        ShortlistItem.added_at,
                    )
                )
            ),
        )


def test_detail_contains_summary_and_description(
    client: FlaskClient, sample_products: list[Product]
) -> None:
    summary = client.get("/api/products").json["data"][0]
    detail = client.get(f"/api/products/{summary['slug']}").json["data"]
    assert detail == {**summary, "description": sample_products[1].description}
    assert {"display_order", "search_text", "title_sort_key"}.isdisjoint(detail)


@pytest.mark.parametrize("slug", ["Upper", "é", "--", "bad--slug", "x" * 81, "a/b", "bad_"])
def test_malformed_detail_slug_is_400(client: FlaskClient, slug: str) -> None:
    response = client.get(f"/api/products/{slug}")
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_request"
    assert response.json["error"]["details"][0]["field"] == "slug"


@pytest.mark.parametrize("slug", ["x", "x" * 80, "valid-product-001"])
def test_valid_absent_slug_is_404(client: FlaskClient, slug: str) -> None:
    response = client.get(f"/api/products/{slug}")
    assert response.status_code == 404
    assert response.json["error"]["code"] == "product_not_found"


def test_bootstrap_reuse_and_fixed_expiry(
    client: FlaskClient, engine: Engine, clock: list[datetime]
) -> None:
    first = client.get("/api/session")
    data = first.json["data"]
    cookie = first.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/" in cookie
    assert "Secure" not in cookie and "Domain=" not in cookie
    assert set(data) == {"session_ref", "csrf_token", "csrf_expires_at", "session_expires_at"}
    assert data["session_expires_at"] == timestamp(clock[0] + timedelta(days=30))
    assert data["csrf_expires_at"] == timestamp(clock[0] + timedelta(hours=1))
    with Session(engine) as database:
        rows = list(database.scalars(select(AnonymousShortlist)))
        assert len(rows) == 1
        assert data["session_ref"] != rows[0].key
        assert rows[0].key not in first.get_data(as_text=True)
    clock[0] += timedelta(hours=2)
    second = client.get("/api/session")
    assert "Set-Cookie" not in second.headers
    assert second.json["data"]["session_ref"] == data["session_ref"]
    assert second.json["data"]["session_expires_at"] == data["session_expires_at"]
    assert second.json["data"]["csrf_token"] != data["csrf_token"]
    assert state(engine)[0][0][1] == timestamp(clock[0] - timedelta(hours=2))


@pytest.mark.parametrize("path", ["/api/session", "/api/shortlist", "/api/shortlist/items/0"])
def test_personalized_errors_are_never_cached(client: FlaskClient, path: str) -> None:
    response = client.get(path)
    assert response.headers["Cache-Control"] == "no-store"
    assert "Cookie" in response.headers["Vary"]


@pytest.mark.parametrize("path", ["/api/session", "/api/shortlist", "/api/products/test-product"])
def test_personal_and_detail_reject_query_or_get_body(client: FlaskClient, path: str) -> None:
    assert client.get(path + "?key=123").status_code == 400
    assert client.get(path, data="body").status_code == 400


@pytest.mark.parametrize("origin", [None, "null", "http://evil.example", "http://localhost:5173/"])
@pytest.mark.parametrize(
    "method,path", [("POST", "/api/shortlist/items"), ("DELETE", "/api/shortlist/items/1")]
)
def test_bad_origins_cannot_change_state(
    client: FlaskClient, engine: Engine, origin: str | None, method: str, path: str
) -> None:
    data = bootstrap(client)
    request_headers = {"X-CSRF-Token": data["csrf_token"]}
    if origin is not None:
        request_headers["Origin"] = origin
    before = state(engine)
    response = client.open(path, method=method, headers=request_headers, json={"product_id": 1})
    assert response.status_code == 403
    assert response.json["error"]["code"] == "origin_forbidden"
    assert state(engine) == before


@pytest.mark.parametrize(
    "request_headers",
    [{"Origin": "null"}, {"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}],
)
def test_cross_site_bootstrap_creates_nothing(
    client: FlaskClient, engine: Engine, request_headers: dict[str, str]
) -> None:
    response = client.get("/api/session", headers=request_headers)
    assert response.status_code == 403
    assert "Set-Cookie" not in response.headers
    assert state(engine) == ([], [])


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/shortlist"),
        ("POST", "/api/shortlist/items"),
        ("DELETE", "/api/shortlist/items/1"),
    ],
)
def test_only_bootstrap_creates_session(
    client: FlaskClient, engine: Engine, method: str, path: str
) -> None:
    response = client.open(path, method=method, headers={"Origin": ORIGIN})
    assert response.status_code == 401
    assert response.json["error"]["code"] == "session_required"
    assert "Set-Cookie" not in response.headers
    assert state(engine) == ([], [])


@pytest.mark.parametrize("token", [None, "invalid", "x" * 2049])
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_bad_csrf_cannot_change_state(
    client: FlaskClient,
    engine: Engine,
    sample_products: list[Product],
    token: str | None,
    method: str,
) -> None:
    data = bootstrap(client)
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    before = state(engine)
    request_headers = {"Origin": ORIGIN}
    if token is not None:
        request_headers["X-CSRF-Token"] = token
    response = (
        client.post("/api/shortlist/items", json={"product_id": 2}, headers=request_headers)
        if method == "POST"
        else client.delete("/api/shortlist/items/1", headers=request_headers)
    )
    assert response.status_code == 403
    assert response.json["error"]["code"] == "csrf_invalid"
    assert state(engine) == before


def test_csrf_expiry_refresh_preserves_session(
    client: FlaskClient, engine: Engine, clock: list[datetime], sample_products: list[Product]
) -> None:
    first = bootstrap(client)
    before = state(engine)
    clock[0] += timedelta(hours=1)
    rejected = client.post("/api/shortlist/items", json={"product_id": 1}, headers=headers(first))
    assert rejected.status_code == 403 and rejected.json["error"]["code"] == "csrf_invalid"
    assert state(engine) == before
    second_response = client.get("/api/session")
    second = second_response.json["data"]
    assert "Set-Cookie" not in second_response.headers
    assert second["session_ref"] == first["session_ref"]
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(second)
        ).status_code
        == 200
    )


def test_sessions_are_isolated_and_csrf_is_bound(
    app: Flask, engine: Engine, sample_products: list[Product]
) -> None:
    one, two = app.test_client(), app.test_client()
    first, second = bootstrap(one), bootstrap(two)
    assert first["session_ref"] != second["session_ref"]
    assert (
        one.post("/api/shortlist/items", json={"product_id": 1}, headers=headers(first)).status_code
        == 200
    )
    assert two.get("/api/shortlist").json == {"data": [], "meta": {"total": 0}}
    before = state(engine)
    rejected = two.post("/api/shortlist/items", json={"product_id": 2}, headers=headers(first))
    assert rejected.status_code == 403 and rejected.json["error"]["code"] == "csrf_invalid"
    assert state(engine) == before
    assert two.delete("/api/shortlist/items/1", headers=headers(second)).status_code == 204
    assert one.get("/api/shortlist").json["meta"]["total"] == 1


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"product_id": True},
        {"product_id": False},
        {"product_id": "1"},
        {"product_id": 1.0},
        {"product_id": 0},
        {"product_id": -1},
        {"product_id": 2147483648},
        {"product_id": 1, "key": "a"},
        [],
        None,
    ],
)
def test_add_body_is_strict_and_atomic(client: FlaskClient, engine: Engine, body: Any) -> None:
    data = bootstrap(client)
    before = state(engine)
    response = client.post(
        "/api/shortlist/items",
        data="null" if body is None else None,
        json=body,
        headers=headers(data),
        content_type="application/json",
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_request"
    assert state(engine) == before


@pytest.mark.parametrize("path", ["0", "-1", "1.0", "2147483648", "true", "a/b"])
def test_delete_identifier_validation(client: FlaskClient, path: str) -> None:
    data = bootstrap(client)
    response = client.delete(f"/api/shortlist/items/{path}", headers=headers(data))
    assert response.status_code == 400
    assert response.json["error"]["details"][0]["field"] == "product_id"


def test_add_transport_and_unknown_product(client: FlaskClient, engine: Engine) -> None:
    data = bootstrap(client)
    before = state(engine)
    assert client.post("/api/shortlist/items", data="{}", headers=headers(data)).status_code == 415
    assert (
        client.post(
            "/api/shortlist/items", data="{", content_type="application/json", headers=headers(data)
        ).status_code
        == 400
    )
    missing = client.post("/api/shortlist/items", json={"product_id": 99}, headers=headers(data))
    assert missing.status_code == 404 and missing.json["error"]["code"] == "product_not_found"
    assert state(engine) == before


def test_membership_idempotency_order_and_timestamps(
    client: FlaskClient, engine: Engine, clock: list[datetime], sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    first = client.post("/api/shortlist/items", json={"product_id": 2}, headers=headers(data))
    assert first.json == {"data": {"product_id": 2, "saved": True}}
    before = state(engine)
    clock[0] += timedelta(minutes=1)
    duplicate = client.post("/api/shortlist/items", json={"product_id": 2}, headers=headers(data))
    assert duplicate.status_code == 200 and "Set-Cookie" not in duplicate.headers
    assert state(engine) == before
    for product_id in (3, 1):
        assert (
            client.post(
                "/api/shortlist/items", json={"product_id": product_id}, headers=headers(data)
            ).status_code
            == 200
        )
    shortlist = client.get("/api/shortlist").json
    assert [row["product"]["id"] for row in shortlist["data"]] == [1, 3, 2]
    assert shortlist["meta"] == {"total": 3}
    assert set(shortlist["data"][0]) == {"product", "added_at"}
    clock[0] += timedelta(minutes=1)
    removed = client.delete("/api/shortlist/items/1", headers=headers(data))
    assert removed.status_code == 204 and removed.data == b""
    before = state(engine)
    clock[0] += timedelta(minutes=1)
    assert client.delete("/api/shortlist/items/1", headers=headers(data)).status_code == 204
    assert client.delete("/api/shortlist/items/999", headers=headers(data)).status_code == 204
    assert state(engine) == before
    assert (
        client.get("/api/session").json["data"]["session_expires_at"] == data["session_expires_at"]
    )


def test_expiry_never_recovers_old_memberships(
    client: FlaskClient, clock: list[datetime], sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    clock[0] += timedelta(days=30)
    assert client.get("/api/shortlist").status_code == 401
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 2}, headers=headers(data)
        ).status_code
        == 401
    )
    assert client.delete("/api/shortlist/items/1", headers=headers(data)).status_code == 401
    fresh = bootstrap(client)
    assert fresh["session_ref"] != data["session_ref"]
    assert client.get("/api/shortlist").json == {"data": [], "meta": {"total": 0}}


def test_cookie_tampering_and_public_ref_give_no_authority(
    app: Flask, client: FlaskClient, sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    cookie = client.get_cookie("roomshelf_session")
    assert cookie is not None
    other = app.test_client()
    for value in (cookie.value + "x", data["session_ref"]):
        other.set_cookie("roomshelf_session", value)
        assert other.get("/api/shortlist").status_code == 401
        assert (
            other.post(
                "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
            ).status_code
            == 401
        )


def test_restart_preserves_session_and_secret_rotation_invalidates(
    app: Flask, client: FlaskClient, sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    cookie = client.get_cookie("roomshelf_session")
    assert cookie is not None
    for secret, expected in ((SECRET, 200), ("different-secret-with-at-least-32-characters", 401)):
        restarted = create_app({"DATABASE_URL": app.config["DATABASE_URL"], "SECRET_KEY": secret})
        try:
            restored = restarted.test_client()
            restored.set_cookie("roomshelf_session", cookie.value)
            response = restored.get("/api/shortlist")
            assert response.status_code == expected
            if expected == 200:
                assert response.json["data"][0]["product"]["id"] == 1
        finally:
            restarted.extensions["roomshelf_engine"].dispose()


def test_missing_db_session_requires_explicit_bootstrap(
    client: FlaskClient, engine: Engine
) -> None:
    data = bootstrap(client)
    with Session(engine) as database, database.begin():
        row = database.scalar(select(AnonymousShortlist))
        assert row is not None
        database.delete(row)
    rejected = client.get("/api/shortlist")
    assert rejected.status_code == 401 and "Set-Cookie" not in rejected.headers
    assert bootstrap(client)["session_ref"] != data["session_ref"]


def test_concurrent_duplicate_add_and_delete_are_idempotent(
    app: Flask, client: FlaskClient, engine: Engine, sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    cookie = client.get_cookie("roomshelf_session")
    assert cookie is not None

    def action(method: str) -> int:
        isolated = app.test_client()
        isolated.set_cookie("roomshelf_session", cookie.value)
        if method == "POST":
            return isolated.post(
                "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
            ).status_code
        return isolated.delete("/api/shortlist/items/1", headers=headers(data)).status_code

    with ThreadPoolExecutor(max_workers=4) as executor:
        assert list(executor.map(action, ["POST"] * 4)) == [200] * 4
    assert len(state(engine)[1]) == 1
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert list(executor.map(action, ["DELETE"] * 4)) == [204] * 4
    assert state(engine)[1] == []


def test_failed_membership_write_rolls_back_everything(
    client: FlaskClient, engine: Engine, clock: list[datetime], sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    before = state(engine)
    clock[0] += timedelta(minutes=1)

    def fail_insert(
        _connection: Any, _cursor: Any, statement: str, _parameters: Any, _context: Any, _many: Any
    ) -> None:
        if statement.startswith("INSERT INTO shortlist_items"):
            raise OperationalError("secret SQL statement", {}, RuntimeError("forced failure"))

    event.listen(engine, "before_cursor_execute", fail_insert)
    try:
        response = client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        )
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
    assert response.status_code == 503
    assert "secret SQL" not in response.get_data(as_text=True)
    assert "Set-Cookie" not in response.headers
    assert state(engine) == before


def test_failed_bootstrap_commit_sets_no_cookie(client: FlaskClient, engine: Engine) -> None:
    def fail_write_commit(_connection: Any) -> None:
        raise OperationalError("secret commit", {}, RuntimeError("forced failure"))

    event.listen(engine, "commit", fail_write_commit)
    try:
        response = client.get("/api/session")
    finally:
        event.remove(engine, "commit", fail_write_commit)
    assert response.status_code == 503
    assert "Set-Cookie" not in response.headers
    assert state(engine) == ([], [])


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_failed_membership_commit_rolls_back_and_preserves_cookie(
    client: FlaskClient,
    engine: Engine,
    clock: list[datetime],
    sample_products: list[Product],
    method: str,
) -> None:
    data = bootstrap(client)
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    before = state(engine)
    original_cookie = client.get_cookie("roomshelf_session")
    clock[0] += timedelta(minutes=1)

    def fail_commit(_connection: Any) -> None:
        raise OperationalError("secret commit", {}, RuntimeError("forced failure"))

    event.listen(engine, "commit", fail_commit)
    try:
        response = (
            client.post("/api/shortlist/items", json={"product_id": 2}, headers=headers(data))
            if method == "POST"
            else client.delete("/api/shortlist/items/1", headers=headers(data))
        )
    finally:
        event.remove(engine, "commit", fail_commit)
    assert response.status_code == 503
    assert "secret commit" not in response.get_data(as_text=True)
    assert "Set-Cookie" not in response.headers
    assert client.get_cookie("roomshelf_session") == original_cookie
    assert state(engine) == before


def test_csrf_expiry_cannot_outlive_absolute_session(
    client: FlaskClient, clock: list[datetime]
) -> None:
    first = bootstrap(client)
    clock[0] += timedelta(days=30, minutes=-30)
    renewed = bootstrap(client)
    assert renewed["session_ref"] == first["session_ref"]
    assert renewed["csrf_expires_at"] == first["session_expires_at"]


def test_tampered_cookie_bootstrap_allocates_fresh_identity(
    client: FlaskClient, engine: Engine, sample_products: list[Product]
) -> None:
    first = bootstrap(client)
    assert (
        client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(first)
        ).status_code
        == 200
    )
    cookie = client.get_cookie("roomshelf_session")
    assert cookie is not None
    client.set_cookie("roomshelf_session", cookie.value + "x")
    replacement = client.get("/api/session")
    assert replacement.status_code == 200 and "Set-Cookie" in replacement.headers
    assert replacement.json["data"]["session_ref"] != first["session_ref"]
    assert client.get("/api/shortlist").json == {"data": [], "meta": {"total": 0}}
    assert len(state(engine)[0]) == 2
    assert len(state(engine)[1]) == 1


def test_development_secret_is_private_stable_and_safe_under_concurrent_creation(
    tmp_path: Path,
) -> None:
    secret_file = tmp_path / "instance" / "session-secret"
    with ThreadPoolExecutor(max_workers=4) as executor:
        values = list(executor.map(_development_secret, [secret_file] * 4))
    assert len(set(values)) == 1
    assert len(values[0]) == 64
    assert secret_file.read_text().strip() == values[0]
    assert secret_file.stat().st_mode & 0o077 == 0
    assert _development_secret(secret_file) == values[0]
    assert list(secret_file.parent.iterdir()) == [secret_file]


def test_database_lock_returns_503_without_partial_membership(
    client: FlaskClient, engine: Engine, sample_products: list[Product]
) -> None:
    data = bootstrap(client)
    before = state(engine)
    with engine.connect() as writer:
        writer.execute(update(AnonymousShortlist).values(updated_at=AnonymousShortlist.updated_at))
        response = client.post(
            "/api/shortlist/items", json={"product_id": 1}, headers=headers(data)
        )
        writer.rollback()
    assert response.status_code == 503 and response.json["error"]["code"] == "database_busy"
    assert state(engine) == before


@pytest.mark.parametrize(
    "config",
    [
        {"SECRET_KEY": None, "PUBLIC_ORIGIN": "https://roomshelf.example"},
        {"SECRET_KEY": "short", "PUBLIC_ORIGIN": "https://roomshelf.example"},
        {"SECRET_KEY": SECRET},
        {"SECRET_KEY": SECRET, "PUBLIC_ORIGIN": "http://roomshelf.example"},
        {"SECRET_KEY": SECRET, "PUBLIC_ORIGIN": "https://roomshelf.example/path"},
        {"SECRET_KEY": SECRET, "PUBLIC_ORIGIN": "https://roomshelf.example/"},
        {"SECRET_KEY": SECRET, "PUBLIC_ORIGIN": "https://u:p@roomshelf.example"},
    ],
)
def test_production_configuration_fails_closed(config: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        create_app({"ROOMSHELF_ENV": "production", **config})


def test_production_cookie_flags_and_origin(app: Flask) -> None:
    production = create_app(
        {
            "DATABASE_URL": app.config["DATABASE_URL"],
            "ROOMSHELF_ENV": "production",
            "SECRET_KEY": SECRET,
            "PUBLIC_ORIGIN": "https://roomshelf.example",
        }
    )
    try:
        client = production.test_client()
        response = client.get("/api/session", base_url="https://roomshelf.example")
        assert response.status_code == 200
        cookie = response.headers["Set-Cookie"]
        assert cookie.startswith("__Host-roomshelf_session=")
        assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/"))
        assert "Domain=" not in cookie
        assert (
            client.get("/api/session", base_url="https://roomshelf.example").headers.get(
                "Set-Cookie"
            )
            is None
        )
    finally:
        production.extensions["roomshelf_engine"].dispose()
