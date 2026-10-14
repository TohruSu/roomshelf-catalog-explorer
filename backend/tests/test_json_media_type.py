from collections.abc import Callable
from typing import Any

import pytest
from flask.testing import FlaskClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from roomshelf.models import AnonymousShortlist, Product, ShortlistItem

SUPPORTED_TYPES = (
    "application/json",
    "application/json; charset=utf-8",
    "Application/JSON; Charset=UTF-8",
    'APPLICATION/JSON ; CHARSET="UTF-8"',
)
UNSUPPORTED_TYPES = (
    None,
    "application/problem+json",
    "application/vnd.example+json",
    "text/json",
    "text/plain",
    "application/octet-stream",
    "application/x-www-form-urlencoded",
    "application/xml",
)


def snapshot(engine: Engine) -> tuple[list[Any], list[Any]]:
    with Session(engine) as database:
        return (
            list(
                database.execute(
                    select(AnonymousShortlist.key, AnonymousShortlist.updated_at).order_by(
                        AnonymousShortlist.key
                    )
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


@pytest.fixture
def mutation_headers(client: FlaskClient, add_product: Callable[..., Product]) -> dict[str, str]:
    add_product()
    add_product(id=2, slug="sample-table-002")
    token = client.get("/api/session").json["data"]["csrf_token"]
    headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": token}
    # Keep an existing membership so rejected requests must preserve real data.
    assert (
        client.post("/api/shortlist/items", json={"product_id": 1}, headers=headers).status_code
        == 200
    )
    return headers


@pytest.mark.parametrize("media_type", SUPPORTED_TYPES)
def test_supported_json_media_types_accept_valid_body(
    client: FlaskClient, mutation_headers: dict[str, str], media_type: str
) -> None:
    response = client.post(
        "/api/shortlist/items",
        data='{"product_id":2}',
        content_type=media_type,
        headers=mutation_headers,
    )
    assert response.status_code == 200
    assert response.json == {"data": {"product_id": 2, "saved": True}}
    assert client.get("/api/shortlist").json["meta"]["total"] == 2


@pytest.mark.parametrize("media_type", UNSUPPORTED_TYPES)
def test_unsupported_json_media_types_are_415_and_preserve_memberships(
    client: FlaskClient,
    engine: Engine,
    mutation_headers: dict[str, str],
    media_type: str | None,
) -> None:
    before = snapshot(engine)
    response = client.post(
        "/api/shortlist/items",
        data='{"product_id":2}',
        content_type=media_type,
        headers=mutation_headers,
    )
    assert response.status_code == 415
    assert response.json == {
        "error": {
            "code": "unsupported_media_type",
            "message": "Content-Type must be application/json.",
            "details": [],
        }
    }
    assert snapshot(engine) == before


@pytest.mark.parametrize("media_type", SUPPORTED_TYPES[:2])
@pytest.mark.parametrize(
    "body", ["{", "null", "[]", '{"product_id":true}', '{"product_id":2,"extra":1}']
)
def test_supported_media_type_still_validates_json_with_400(
    client: FlaskClient,
    engine: Engine,
    mutation_headers: dict[str, str],
    media_type: str,
    body: str,
) -> None:
    before = snapshot(engine)
    response = client.post(
        "/api/shortlist/items", data=body, content_type=media_type, headers=mutation_headers
    )
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_request"
    assert snapshot(engine) == before


@pytest.mark.parametrize(
    "credentials,expected_code",
    [
        ({"Origin": "https://foreign.example"}, "origin_forbidden"),
        ({"Origin": None}, "origin_forbidden"),
        ({"X-CSRF-Token": "invalid-token"}, "csrf_invalid"),
        ({"X-CSRF-Token": None}, "csrf_invalid"),
    ],
)
def test_credentials_are_rejected_before_media_type_validation(
    client: FlaskClient,
    engine: Engine,
    mutation_headers: dict[str, str],
    credentials: dict[str, str | None],
    expected_code: str,
) -> None:
    headers = dict(mutation_headers)
    for name, value in credentials.items():
        if value is None:
            headers.pop(name)
        else:
            headers[name] = value
    before = snapshot(engine)
    response = client.post(
        "/api/shortlist/items", data="{", content_type="application/problem+json", headers=headers
    )
    assert response.status_code == 403
    assert response.json["error"]["code"] == expected_code
    assert snapshot(engine) == before


@pytest.mark.parametrize("size,expected_status", [(4096, 200), (4097, 413)])
def test_supported_json_preserves_exact_body_limit(
    client: FlaskClient,
    engine: Engine,
    mutation_headers: dict[str, str],
    size: int,
    expected_status: int,
) -> None:
    body = '{"product_id":2}'
    body += " " * (size - len(body.encode()))
    before = snapshot(engine)
    response = client.post(
        "/api/shortlist/items",
        data=body,
        content_type="application/json; charset=utf-8",
        headers=mutation_headers,
    )
    assert response.status_code == expected_status
    if expected_status == 413:
        assert response.json["error"]["code"] == "body_too_large"
        assert snapshot(engine) == before
    else:
        assert client.get("/api/shortlist").json["meta"]["total"] == 2
