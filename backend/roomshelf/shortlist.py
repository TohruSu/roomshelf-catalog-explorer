import re
import secrets

from flask import Blueprint, Response, jsonify, request, session
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError
from sqlalchemy import false, select, update
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from .catalog import product_summary
from .db import get_engine
from .errors import ApiError, invalid_request
from .models import MAX_INTEGER, AnonymousShortlist, Product, ShortlistItem
from .security import (
    SESSION_LIFETIME,
    active_shortlist,
    now,
    require_shortlist,
    session_payload,
    timestamp,
    validate_csrf,
    validate_origin,
)
from .validation import validate_no_query

personal = Blueprint("shortlist", __name__, url_prefix="/api")


class AddItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: StrictInt = Field(ge=1, le=MAX_INTEGER)


def _lock_writes(database: Session) -> None:
    # Python 3.12 autocommit=False already opens BEGIN. A no-row UPDATE obtains
    # SQLite's write reservation before reads, avoiding a WAL snapshot upgrade.
    database.execute(
        update(AnonymousShortlist).where(false()).values(updated_at=AnonymousShortlist.updated_at)
    )


def _no_query() -> None:
    if request.args:
        raise invalid_request(
            next(iter(request.args)), "This endpoint accepts no query parameters."
        )


def _add_body() -> AddItem:
    if not request.is_json:
        raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json.")
    try:
        values = request.get_json()
    except BadRequest as error:
        raise invalid_request("body", "Must contain valid JSON.") from error
    if not isinstance(values, dict):
        raise invalid_request("body", "Must be a JSON object.")
    try:
        return AddItem.model_validate(values)
    except ValidationError as error:
        details = [
            {"field": str(issue["loc"][0]), "message": issue["msg"]}
            for issue in error.errors(include_input=False, include_url=False)
        ]
        raise ApiError(400, "invalid_request", "Request validation failed.", details) from error


def _product_id(value: str) -> int:
    if re.fullmatch(r"[0-9]+", value) is None:
        raise invalid_request("product_id", "Must be a positive integer containing digits only.")
    significant = value.lstrip("0") or "0"
    if len(significant) > 10 or not 1 <= int(significant) <= MAX_INTEGER:
        raise invalid_request("product_id", "Must be between 1 and 2147483647.")
    return int(significant)


@personal.get("/session")
def get_session() -> Response:
    validate_no_query()
    validate_origin(required=False)
    with Session(get_engine()) as database, database.begin():
        # Only the bootstrap endpoint may create or replace a session.
        shortlist = active_shortlist(database)
        if shortlist is not None:
            payload = session_payload(shortlist)
            return jsonify(data=payload)
    with Session(get_engine(), expire_on_commit=False) as database, database.begin():
        _lock_writes(database)
        current = now()
        shortlist = AnonymousShortlist(
            key=secrets.token_hex(32),
            created_at=timestamp(current),
            updated_at=timestamp(current),
            expires_at=timestamp(current + SESSION_LIFETIME),
        )
        database.add(shortlist)
    # Do not issue a cookie for an allocation whose database commit failed.
    session.clear()
    session.update(key=shortlist.key, nonce=secrets.token_hex(32), expires_at=shortlist.expires_at)
    session.permanent = True
    payload = session_payload(shortlist)
    return jsonify(data=payload)


@personal.get("/shortlist")
def get_shortlist() -> Response:
    validate_no_query()
    validate_origin(required=False)
    with Session(get_engine()) as database, database.begin():
        shortlist = require_shortlist(database)
        rows = database.execute(
            select(Product, ShortlistItem.added_at)
            .join(ShortlistItem, ShortlistItem.product_id == Product.id)
            .where(ShortlistItem.shortlist_key == shortlist.key)
            .order_by(ShortlistItem.added_at.desc(), ShortlistItem.product_id.asc())
        ).all()
        data = [{"product": product_summary(product), "added_at": added} for product, added in rows]
    return jsonify(data=data, meta={"total": len(data)})


@personal.post("/shortlist/items")
def add_item() -> Response:
    validate_origin(required=True)
    _no_query()
    with Session(get_engine()) as database, database.begin():
        _lock_writes(database)
        shortlist = require_shortlist(database)
        validate_csrf()
        body = _add_body()
        if database.get(Product, body.product_id) is None:
            raise ApiError(404, "product_not_found", "Product was not found.")
        identity = (shortlist.key, body.product_id)
        if database.get(ShortlistItem, identity) is None:
            current = timestamp(now())
            database.add(
                ShortlistItem(
                    shortlist_key=shortlist.key, product_id=body.product_id, added_at=current
                )
            )
            shortlist.updated_at = current
    return jsonify(data={"product_id": body.product_id, "saved": True})


@personal.delete("/shortlist/items/<path:raw_product_id>")
def remove_item(raw_product_id: str) -> tuple[Response, int]:
    validate_origin(required=True)
    _no_query()
    with Session(get_engine()) as database, database.begin():
        _lock_writes(database)
        shortlist = require_shortlist(database)
        validate_csrf()
        if request.get_data(cache=True):
            raise invalid_request("body", "DELETE requests must not include a body.")
        product_id = _product_id(raw_product_id)
        item = database.get(ShortlistItem, (shortlist.key, product_id))
        if item is not None:
            database.delete(item)
            shortlist.updated_at = timestamp(now())
    return Response(status=204), 204
