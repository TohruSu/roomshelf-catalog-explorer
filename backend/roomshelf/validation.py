import re
from typing import Any, Literal

from flask import request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, field_validator

from .errors import ApiError, invalid_request
from .models import MAX_INTEGER, Category, Material
from .normalization import normalize_text

Sort = Literal["featured", "price_asc", "price_desc", "title_asc"]
INTEGER_PARAMETERS = {"min_price", "max_price", "max_width", "page", "page_size"}
REPEATED_PARAMETERS = {"category", "material"}


class CatalogQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: str = ""
    category: list[Category] = Field(default_factory=list)
    material: list[Material] = Field(default_factory=list)
    min_price: StrictInt | None = Field(default=None, ge=0, le=MAX_INTEGER)
    max_price: StrictInt | None = Field(default=None, ge=0, le=MAX_INTEGER)
    max_width: StrictInt | None = Field(default=None, ge=1, le=1000)
    sort: Sort = "featured"
    page: StrictInt = Field(default=1, ge=1, le=10_000)
    page_size: StrictInt = Field(default=12, ge=1, le=48)

    @field_validator("q")
    @classmethod
    def normalized_search(cls, value: str) -> str:
        normalized = normalize_text(value)
        if len(normalized) > 100:
            raise ValueError("Must contain at most 100 normalized characters.")
        if len(normalized.split()) > 8:
            raise ValueError("Must contain at most eight search terms.")
        return normalized


def reject_get_body() -> None:
    if request.get_data(cache=True):
        raise invalid_request("body", "GET requests must not include a body.")


def parse_catalog_query() -> CatalogQuery:
    reject_get_body()
    values: dict[str, Any] = {}
    known = set(CatalogQuery.model_fields)
    for name, entries in request.args.lists():
        if name not in known:
            raise invalid_request(name, "Unknown parameter.")
        if name in REPEATED_PARAMETERS:
            values[name] = list(dict.fromkeys(entries))
            continue
        if len(entries) != 1:
            raise invalid_request(name, "Must occur only once.")
        value = entries[0]
        if name in INTEGER_PARAMETERS:
            if not re.fullmatch(r"[0-9]+", value):
                raise invalid_request(name, "Must be an integer containing digits only.")
            significant = value.lstrip("0") or "0"
            if len(significant) > 10:
                raise invalid_request(name, "Integer is outside the allowed range.")
            values[name] = int(significant)
        else:
            values[name] = value
    try:
        query = CatalogQuery.model_validate(values)
    except ValidationError as error:
        details = []
        for issue in error.errors(include_input=False, include_url=False):
            location = issue["loc"]
            field = str(location[0]) if location else "query"
            message = issue["msg"].removeprefix("Value error, ")
            details.append({"field": field, "message": message})
        raise ApiError(400, "invalid_request", "Request validation failed.", details) from error
    if (
        query.min_price is not None
        and query.max_price is not None
        and query.max_price < query.min_price
    ):
        raise invalid_request("max_price", "Must be greater than or equal to min_price.")
    return query


def validate_no_query() -> None:
    reject_get_body()
    if request.args:
        name = next(iter(request.args))
        raise invalid_request(name, "This endpoint accepts no query parameters.")
