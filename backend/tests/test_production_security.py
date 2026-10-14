import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from flask import Flask, Response
from flask.testing import FlaskClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from roomshelf import create_app
from roomshelf.models import AnonymousShortlist, Product, ShortlistItem
from roomshelf.security import timestamp

ORIGIN = "https://roomshelf.example"
SECRET = "production-test-only-signing-key-0123456789"
COOKIE_NAME = "__Host-roomshelf_session"


@pytest.fixture
def production_app(app: Flask, sample_products: list[Product]) -> Iterator[Flask]:
    application = create_app(
        {
            "TESTING": True,
            "ROOMSHELF_ENV": "production",
            "DATABASE_URL": app.config["DATABASE_URL"],
            "SECRET_KEY": SECRET,
            "PUBLIC_ORIGIN": ORIGIN,
        }
    )
    yield application
    application.extensions["roomshelf_engine"].dispose()


@pytest.fixture
def production_client(production_app: Flask) -> FlaskClient:
    return production_app.test_client()


@pytest.fixture
def production_clock(production_app: Flask) -> list[datetime]:
    value = [datetime(2026, 10, 14, 12, tzinfo=UTC)]
    production_app.config["ROOMSHELF_CLOCK"] = lambda: value[0]
    return value


def bootstrap(client: FlaskClient) -> dict[str, Any]:
    response = client.get("/api/session", base_url=ORIGIN)
    assert response.status_code == 200
    return response.json["data"]


def headers(data: dict[str, Any]) -> dict[str, str]:
    return {"Origin": ORIGIN, "X-CSRF-Token": data["csrf_token"]}


def state(app: Flask) -> tuple[list[Any], list[Any]]:
    engine: Engine = app.extensions["roomshelf_engine"]
    with Session(engine) as database:
        return (
            list(
                database.execute(
                    select(
                        AnonymousShortlist.key,
                        AnonymousShortlist.created_at,
                        AnonymousShortlist.updated_at,
                        AnonymousShortlist.expires_at,
                    ).order_by(AnonymousShortlist.key)
                )
            ),
            list(
                database.execute(
                    select(
                        ShortlistItem.shortlist_key,
                        ShortlistItem.product_id,
                        ShortlistItem.added_at,
                    ).order_by(ShortlistItem.shortlist_key, ShortlistItem.product_id)
                )
            ),
        )


@pytest.mark.parametrize("secret", [None, "", "x" * 31, b"x" * 32, 123, False, {}])
def test_production_rejects_missing_short_or_non_string_secret(tmp_path: Path, secret: Any) -> None:
    database = tmp_path / "must-not-be-created.sqlite3"
    with pytest.raises(ValueError, match="at least 32 characters"):
        create_app(
            {
                "ROOMSHELF_ENV": "production",
                "DATABASE_URL": f"sqlite:///{database}",
                "SECRET_KEY": secret,
                "PUBLIC_ORIGIN": ORIGIN,
            }
        )
    assert not database.exists()


@pytest.mark.parametrize(
    "origin",
    [
        None,
        123,
        "",
        "http://roomshelf.example",
        "ftp://roomshelf.example",
        "https://",
        "https://roomshelf.example/",
        "https://roomshelf.example/path",
        "https://roomshelf.example?query=1",
        "https://roomshelf.example#fragment",
        "https://user@roomshelf.example",
        "https://user:password@roomshelf.example",
        "https://ROOMSHELF.example",
        "https://roomshelf.example:0",
        "https://roomshelf.example:65536",
        "https://roomshelf.example:invalid",
    ],
)
def test_production_rejects_non_exact_https_origin(tmp_path: Path, origin: Any) -> None:
    database = tmp_path / "must-not-be-created.sqlite3"
    with pytest.raises(ValueError, match="ROOMSHELF_PUBLIC_ORIGIN"):
        create_app(
            {
                "ROOMSHELF_ENV": "production",
                "DATABASE_URL": f"sqlite:///{database}",
                "SECRET_KEY": SECRET,
                "PUBLIC_ORIGIN": origin,
            }
        )
    assert not database.exists()


def test_production_accepts_minimum_secret_and_explicit_https_port(app: Flask) -> None:
    production = create_app(
        {
            "ROOMSHELF_ENV": "production",
            "DATABASE_URL": app.config["DATABASE_URL"],
            "SECRET_KEY": "x" * 32,
            "PUBLIC_ORIGIN": "https://roomshelf.example:8443",
        }
    )
    try:
        response = production.test_client().get(
            "/api/session", base_url="https://roomshelf.example:8443"
        )
        assert response.status_code == 200
        assert production.config["PUBLIC_ORIGIN"] == "https://roomshelf.example:8443"
    finally:
        production.extensions["roomshelf_engine"].dispose()


def test_https_cookie_and_authenticated_post_delete(production_client: FlaskClient) -> None:
    response = production_client.get("/api/session", base_url=ORIGIN)
    assert response.status_code == 200
    cookie_header = response.headers["Set-Cookie"]
    assert cookie_header.startswith(f"{COOKIE_NAME}=")
    assert all(flag in cookie_header for flag in ("Secure", "HttpOnly", "SameSite=Lax", "Path=/"))
    assert "Domain=" not in cookie_header
    cookie = production_client.get_cookie(COOKIE_NAME, domain="roomshelf.example")
    assert cookie is not None and cookie.secure and cookie.http_only
    assert cookie.path == "/" and cookie.origin_only and cookie.same_site == "Lax"
    data = response.json["data"]
    saved = production_client.post(
        "/api/shortlist/items", base_url=ORIGIN, json={"product_id": 1}, headers=headers(data)
    )
    assert saved.status_code == 200
    assert saved.json == {"data": {"product_id": 1, "saved": True}}
    assert "Set-Cookie" not in saved.headers
    listed = production_client.get("/api/shortlist", base_url=ORIGIN)
    assert listed.status_code == 200 and listed.json["data"][0]["product"]["id"] == 1
    removed = production_client.delete(
        "/api/shortlist/items/1", base_url=ORIGIN, headers=headers(data)
    )
    assert removed.status_code == 204 and removed.data == b""
    assert "Set-Cookie" not in removed.headers
    assert production_client.get("/api/shortlist", base_url=ORIGIN).json == {
        "data": [],
        "meta": {"total": 0},
    }


@pytest.mark.parametrize(
    "origin",
    [None, "http://roomshelf.example", "https://foreign.example", ORIGIN + ":8443", "null"],
)
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_production_origin_rejection_leaves_every_row_unchanged(
    production_app: Flask, production_client: FlaskClient, origin: str | None, method: str
) -> None:
    data = bootstrap(production_client)
    assert (
        production_client.post(
            "/api/shortlist/items", base_url=ORIGIN, json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    before = state(production_app)
    request_headers = {"X-CSRF-Token": data["csrf_token"]}
    if origin is not None:
        request_headers["Origin"] = origin
    response = (
        production_client.post(
            "/api/shortlist/items",
            base_url=ORIGIN,
            json={"product_id": 2},
            headers=request_headers,
        )
        if method == "POST"
        else production_client.delete(
            "/api/shortlist/items/1", base_url=ORIGIN, headers=request_headers
        )
    )
    assert response.status_code == 403
    assert response.json["error"]["code"] == "origin_forbidden"
    assert response.headers["Cache-Control"] == "no-store"
    assert "Set-Cookie" not in response.headers
    assert state(production_app) == before


@pytest.mark.parametrize("token_kind", ["missing", "invalid", "expired", "other_session"])
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_production_csrf_rejection_leaves_membership_and_identity_unchanged(
    production_app: Flask,
    production_client: FlaskClient,
    production_clock: list[datetime],
    token_kind: str,
    method: str,
) -> None:
    data = bootstrap(production_client)
    assert (
        production_client.post(
            "/api/shortlist/items", base_url=ORIGIN, json={"product_id": 1}, headers=headers(data)
        ).status_code
        == 200
    )
    request_headers = {"Origin": ORIGIN}
    if token_kind == "invalid":
        request_headers["X-CSRF-Token"] = "invalid-token"
    elif token_kind == "expired":
        request_headers["X-CSRF-Token"] = data["csrf_token"]
        production_clock[0] += timedelta(hours=1)
    elif token_kind == "other_session":
        request_headers["X-CSRF-Token"] = bootstrap(production_app.test_client())["csrf_token"]
    before = state(production_app)
    original_cookie = production_client.get_cookie(COOKIE_NAME, domain="roomshelf.example")
    response = (
        production_client.post(
            "/api/shortlist/items",
            base_url=ORIGIN,
            json={"product_id": 2},
            headers=request_headers,
        )
        if method == "POST"
        else production_client.delete(
            "/api/shortlist/items/1", base_url=ORIGIN, headers=request_headers
        )
    )
    assert response.status_code == 403 and response.json["error"]["code"] == "csrf_invalid"
    assert state(production_app) == before
    assert production_client.get_cookie(COOKIE_NAME, domain="roomshelf.example") == original_cookie
    assert "Set-Cookie" not in response.headers


def test_production_identity_and_expiry_are_absolute_without_cookie_renewal(
    production_app: Flask, production_client: FlaskClient, production_clock: list[datetime]
) -> None:
    initial_response = production_client.get("/api/session", base_url=ORIGIN)
    first = initial_response.json["data"]
    cookie = production_client.get_cookie(COOKIE_NAME, domain="roomshelf.example")
    assert cookie is not None
    deadline = production_clock[0] + timedelta(days=30)
    assert cookie.expires == deadline
    production_clock[0] += timedelta(minutes=10)
    saved = production_client.post(
        "/api/shortlist/items", base_url=ORIGIN, json={"product_id": 1}, headers=headers(first)
    )
    assert saved.status_code == 200 and "Set-Cookie" not in saved.headers
    production_clock[0] += timedelta(hours=2)
    refreshed_response = production_client.get("/api/session", base_url=ORIGIN)
    refreshed = refreshed_response.json["data"]
    assert "Set-Cookie" not in refreshed_response.headers
    assert refreshed["session_ref"] == first["session_ref"]
    assert refreshed["session_expires_at"] == first["session_expires_at"] == timestamp(deadline)
    assert refreshed["csrf_token"] != first["csrf_token"]
    assert production_client.get_cookie(COOKIE_NAME, domain="roomshelf.example") == cookie
    production_clock[0] = deadline
    before = state(production_app)
    expired = production_client.get("/api/shortlist", base_url=ORIGIN)
    assert expired.status_code == 401 and expired.json["error"]["code"] == "session_required"
    assert "Set-Cookie" not in expired.headers
    assert state(production_app) == before
    replacement = production_client.get("/api/session", base_url=ORIGIN)
    assert replacement.status_code == 200 and "Set-Cookie" in replacement.headers
    assert replacement.json["data"]["session_ref"] != first["session_ref"]
    assert production_client.get("/api/shortlist", base_url=ORIGIN).json["meta"]["total"] == 0


def test_production_personal_responses_and_errors_are_uncacheable_and_secret_free(
    production_app: Flask, production_client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    marker = "private-query-cookie-and-token-marker"

    @production_app.get("/api/shortlist/test-failure")
    def fail() -> Response:
        raise RuntimeError(f"{marker} {SECRET}")

    successful_session = production_client.get("/api/session", base_url=ORIGIN)
    successful_shortlist = production_client.get("/api/shortlist", base_url=ORIGIN)
    with caplog.at_level(logging.ERROR, logger=production_app.logger.name):
        failure = production_client.get("/api/shortlist/test-failure", base_url=ORIGIN)
    assert failure.status_code == 500
    assert failure.json == {
        "error": {
            "code": "internal_error",
            "message": "An unexpected error occurred.",
            "details": [],
        }
    }
    for response in (successful_session, successful_shortlist, failure):
        assert response.headers["Cache-Control"] == "no-store"
        assert "Cookie" in response.headers["Vary"]
        assert SECRET not in response.get_data(as_text=True)
        assert marker not in response.get_data(as_text=True)
    assert "Unexpected request failure (RuntimeError)" in caplog.text
    assert marker not in caplog.text and SECRET not in caplog.text


def test_api_deny_all_csp_does_not_apply_to_frontend_html(production_app: Flask) -> None:
    @production_app.get("/fixture-frontend")
    @production_app.get("/apiary")
    def fixture_frontend() -> Response:
        return Response("<html><body>Static server fixture</body></html>", mimetype="text/html")

    client = production_app.test_client()
    for path in ("/api/health", "/api", "/api/missing-route"):
        response = client.get(path, base_url=ORIGIN)
        assert response.headers["Content-Security-Policy"] == (
            "default-src 'none'; frame-ancestors 'none'"
        )
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
    for path in ("/fixture-frontend", "/apiary"):
        html = client.get(path, base_url=ORIGIN)
        assert html.status_code == 200 and html.mimetype == "text/html"
        assert "Content-Security-Policy" not in html.headers
        assert "Cache-Control" not in html.headers
