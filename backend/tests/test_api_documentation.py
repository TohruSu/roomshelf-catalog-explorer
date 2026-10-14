"""Keep public examples consistent with the independent deterministic seed/API."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine

from roomshelf.seed import seed_database

SOURCE = (Path(__file__).resolve().parents[2] / "docs/API.md").read_text(encoding="utf-8")
EXAMPLES = [json.loads(body) for body in re.findall(r"```json\s*\n(.*?)```", SOURCE, re.DOTALL)]


def test_complete_public_response_examples(client: FlaskClient, engine: Engine) -> None:
    seed_database(engine)
    examples = re.findall(
        r"<!-- api-example: GET ([^ ]+) -->\s*```json\s*\n(.*?)```", SOURCE, re.DOTALL
    )
    assert len(examples) == 2
    for path, body in examples:
        response = client.get(path)
        assert response.status_code == 200
        assert response.get_json() == json.loads(body)
    summary = next(example for example in EXAMPLES if "slug" in example)
    assert summary == client.get("/api/products?page_size=1").get_json()["data"][0]


def test_error_example(client: FlaskClient) -> None:
    example = next(example for example in EXAMPLES if "error" in example)
    response = client.get("/api/products/Invalid")
    assert response.status_code == 400
    assert response.get_json() == example


def test_shortlist_and_session_example_shapes(
    app: Flask, client: FlaskClient, engine: Engine
) -> None:
    seed_database(engine)
    app.config["ROOMSHELF_CLOCK"] = lambda: datetime(2026, 10, 14, tzinfo=UTC)
    session_data = client.get("/api/session").get_json()["data"]
    session_example = next(
        example["data"] for example in EXAMPLES if "session_ref" in example.get("data", {})
    )
    assert session_data.keys() == session_example.keys()
    for field in ("csrf_expires_at", "session_expires_at"):
        assert session_data[field] == session_example[field]
    assert len(session_data["session_ref"]) == 64
    assert session_data["csrf_token"] != session_example["csrf_token"]
    response = client.post(
        "/api/shortlist/items",
        json={"product_id": 1},
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": session_data["csrf_token"]},
    )
    assert response.status_code == 200
    example = next(example for example in EXAMPLES if example.get("meta") == {"total": 1})
    assert client.get("/api/shortlist").get_json() == example
