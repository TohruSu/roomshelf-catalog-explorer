from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from roomshelf import create_app
from roomshelf.models import AnonymousShortlist, Product, ShortlistItem
from roomshelf.security import configure_security

SECRET = "origin-test-only-signing-key-0123456789"


@pytest.mark.parametrize(
    ("environment", "origin"),
    [
        ("development", "http://localhost:5173"),
        ("development", "http://localhost"),
        ("development", "http://127.0.0.1:4173"),
        ("development", "http://[::1]:5173"),
        ("development", "https://localhost"),
        ("development", "http://localhost:443"),
        ("production", "https://roomshelf.example"),
        ("production", "https://roomshelf.example:8443"),
        ("production", "https://roomshelf.example:80"),
        ("production", "https://roomshelf.example:1"),
        ("production", "https://roomshelf.example:65535"),
        ("production", "https://roomshelf.example."),
        ("production", "https://127.0.0.1"),
        ("production", "https://192.0.2.1:8443"),
        ("production", "https://[::1]"),
        ("production", "https://[::]"),
        ("production", "https://[::1:2:3:4:5:6]"),
        ("production", "https://[2001:db8::1]:8443"),
        ("production", "https://[2001:db8:1:2:3:4::]"),
        ("production", "https://[2001:db8:0:1:2:3:4:5]"),
        ("production", "https://[2001:db8:1:2:3:4:5:6]"),
        ("production", "https://[::ffff:c000:201]"),
        ("production", "https://[2001::1:0:0:1:1]"),
        ("production", "https://xn--fa-hia.example"),
        ("production", "https://xn--e1afmkfd.example"),
        ("production", "https://xn--6xa.example"),
        ("production", "https://xn--mgbh0fb.example"),
        ("production", "https://0xg.example"),
        ("production", "https://roomshelf.123e4"),
    ],
)
def test_canonical_origin_is_accepted_without_rewriting(environment: str, origin: str) -> None:
    app = Flask(__name__)
    app.config.update(ROOMSHELF_ENV=environment, SECRET_KEY=SECRET, PUBLIC_ORIGIN=origin)
    configure_security(app)
    assert app.config["PUBLIC_ORIGIN"] == origin
    assert app.config["SESSION_COOKIE_SECURE"] is (environment == "production")


@pytest.mark.parametrize(
    ("environment", "origin"),
    [
        ("development", "http://localhost:80"),
        ("development", "http://localhost:"),
        ("development", "http://localhost:05173"),
        ("development", "https://localhost:443"),
        ("development", ""),
        ("development", 0),
        ("development", False),
        ("production", "http://roomshelf.example"),
        ("production", "https://roomshelf.example:443"),
        ("production", "https://roomshelf.example:"),
        ("production", "https://roomshelf.example:08443"),
        ("production", "https://roomshelf.example:0443"),
        ("production", "https://roomshelf.example:0"),
        ("production", "https://roomshelf.example:65536"),
        ("production", "https://roomshelf.example:+8443"),
        ("production", "https://roomshelf.example:-1"),
        ("production", "https://roomshelf.example:invalid"),
        ("production", "https://roomshelf.example:8443:1"),
        ("production", "https://ROOMSHELF.example"),
        ("production", "HTTPS://roomshelf.example"),
        ("production", "https://roomshelf.example/"),
        ("production", "https://roomshelf.example/path"),
        ("production", "https://roomshelf.example?"),
        ("production", "https://roomshelf.example#"),
        ("production", "https://user@roomshelf.example"),
        ("production", "https://user:password@roomshelf.example"),
        ("production", "https://"),
        ("production", "https:///roomshelf.example"),
        ("production", " https://roomshelf.example"),
        ("production", "https://roomshelf.example "),
        ("production", "https://room\nshelf.example"),
        ("production", "https://roomshelf.\texample"),
        ("production", "https://roomshelf.example\x00"),
        ("production", "https://roomshelf.example\x7f"),
        ("production", "https://room shelf.example"),
        ("production", "https://roomshelf\\example"),
        ("production", "https://röömshelf.example"),
        ("production", "https://%72oomshelf.example"),
        ("production", "https://room_shelf.example"),
        ("production", "https://-roomshelf.example"),
        ("production", "https://roomshelf-.example"),
        ("production", "https://.roomshelf.example"),
        ("production", "https://roomshelf..example"),
        ("production", "https://roomshelf.example.."),
        ("production", f"https://{'a' * 64}.example"),
        ("production", f"https://{'a' * 63}.{'b' * 63}.{'c' * 63}.{'d' * 63}"),
        ("production", "https://xn--a.example"),
        ("production", "https://xn--0.example"),
        ("production", "https://xn--abc-.example"),
        ("production", "https://xn--6a.example"),
        ("production", "https://xn--3ba.example"),
        ("production", "https://xn--7ba.example"),
        ("production", "https://xn--ksa.example"),
        ("production", "https://xn--zva.example"),
        ("production", "https://xn--zvg.example"),
        ("production", "https://xn--a-wbd.example"),
        ("production", "https://xn--a-4nd.example"),
        ("production", "https://xn--a-xbd.example"),
        ("production", "https://xn--1-bqc59h.example"),
        ("production", "https://xn----wbd.example"),
        ("production", "https://roomshelf.123"),
        ("production", "https://roomshelf.0x"),
        ("production", "https://roomshelf.09"),
        ("production", "https://127.1"),
        ("production", "https://2130706433"),
        ("production", "https://0x7f.0.0.1"),
        ("production", "https://127.00.0.1"),
        ("production", "https://127.0.0.1."),
        ("production", "https://256.0.0.1"),
        ("production", "https://[::1"),
        ("production", "https://::1"),
        ("production", "https://[not-an-address]"),
        ("production", "https://[127.0.0.1]"),
        ("production", "https://[::1]junk"),
        ("production", "https://[2001:DB8::1]"),
        ("production", "https://[2001:0db8::1]"),
        ("production", "https://[0:0:0:0:0:0:0:1]"),
        ("production", "https://[2001:0:0:1::1:1]"),
        ("production", "https://[2001:db8::1:2:3:4:5]"),
        ("production", "https://[::ffff:192.0.2.1]"),
        ("production", "https://[fe80::1%eth0]"),
        ("production", "https://[fe80::1%25eth0]"),
        ("production", "https://[::1]:443"),
        ("production", "https://[::1]:"),
        ("production", "https://[::1]:08443"),
    ],
)
def test_noncanonical_origin_is_rejected_before_database_creation(
    tmp_path: Path, environment: str, origin: Any
) -> None:
    database = tmp_path / "must-not-be-created.sqlite3"
    with pytest.raises(ValueError, match="ROOMSHELF_PUBLIC_ORIGIN") as failure:
        create_app(
            {
                "ROOMSHELF_ENV": environment,
                "SECRET_KEY": SECRET,
                "PUBLIC_ORIGIN": origin,
                "DATABASE_URL": f"sqlite:///{database}",
            }
        )
    assert SECRET not in str(failure.value)
    if isinstance(origin, str) and origin:
        assert origin not in str(failure.value)
    assert not database.exists()


def test_absent_development_origin_keeps_localhost_default() -> None:
    app = Flask(__name__)
    app.config.update(ROOMSHELF_ENV="development", SECRET_KEY=SECRET, PUBLIC_ORIGIN=None)
    configure_security(app)
    assert app.config["PUBLIC_ORIGIN"] == "http://localhost:5173"


@pytest.mark.parametrize(
    ("origin", "noncanonical_header"),
    [
        ("https://roomshelf.example", "https://roomshelf.example:443"),
        ("https://roomshelf.example:8443", "https://roomshelf.example:08443"),
        ("https://[2001:db8::1]:8443", "https://[2001:0db8::1]:8443"),
    ],
)
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_request_origin_remains_exact_and_rejection_preserves_all_rows(
    app: Flask,
    sample_products: list[Product],
    origin: str,
    noncanonical_header: str,
    method: str,
) -> None:
    app.config.update(ROOMSHELF_ENV="production", PUBLIC_ORIGIN=origin)
    configure_security(app)
    client = app.test_client()
    response = client.get("/api/session", base_url=origin)
    assert response.status_code == 200
    token = response.json["data"]["csrf_token"]
    assert (
        client.post(
            "/api/shortlist/items",
            base_url=origin,
            json={"product_id": 1},
            headers={"Origin": origin, "X-CSRF-Token": token},
        ).status_code
        == 200
    )

    def rows() -> tuple[list[Any], list[Any]]:
        with Session(app.extensions["roomshelf_engine"]) as database:
            return (
                list(database.execute(select(AnonymousShortlist.__table__))),
                list(database.execute(select(ShortlistItem.__table__))),
            )

    before = rows()
    headers = {"Origin": noncanonical_header, "X-CSRF-Token": token}
    rejected = (
        client.post(
            "/api/shortlist/items", base_url=origin, json={"product_id": 2}, headers=headers
        )
        if method == "POST"
        else client.delete("/api/shortlist/items/1", base_url=origin, headers=headers)
    )
    assert rejected.status_code == 403
    assert rejected.json["error"]["code"] == "origin_forbidden"
    assert "Set-Cookie" not in rejected.headers
    assert rows() == before
    listed = client.get("/api/shortlist", base_url=origin)
    assert listed.status_code == 200
    assert [item["product"]["id"] for item in listed.json["data"]] == [1]
