from typing import Any

from flask import Blueprint, Response, jsonify
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from .db import SchemaMismatch, check_schema, get_engine
from .errors import ApiError, invalid_request
from .models import Product
from .slugs import validate_slug
from .validation import parse_catalog_query, validate_no_query

api = Blueprint("catalog", __name__, url_prefix="/api")


@api.get("/products/<path:slug>")
def product_detail(slug: str) -> Response:
    validate_no_query()
    try:
        validate_slug(slug)
    except ValueError as error:
        raise invalid_request("slug", str(error)) from error
    with Session(get_engine()) as database, database.begin():
        product = database.scalar(select(Product).where(Product.slug == slug))
        if product is None:
            raise ApiError(404, "product_not_found", "Product was not found.")
        data = {**product_summary(product), "description": product.description}
    return jsonify(data=data)


def product_summary(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "slug": product.slug,
        "title": product.title,
        "category": product.category,
        "material": product.material,
        "color": product.color,
        "price_jpy": product.price_jpy,
        "dimensions_cm": {
            "width": product.width_cm,
            "depth": product.depth_cm,
            "height": product.height_cm,
        },
        "availability": product.availability,
        "illustration_key": product.illustration_key,
    }


@api.get("/health")
def health() -> Response:
    validate_no_query()
    engine = get_engine()
    try:
        check_schema(engine)
    except SchemaMismatch as error:
        raise ApiError(
            503, "database_unavailable", "Database schema is not initialized."
        ) from error
    with Session(engine) as session, session.begin():
        session.execute(select(Product.id).limit(1)).all()
    return jsonify(data={"status": "ok", "database": "ok"})


@api.get("/filters")
def filters() -> Response:
    validate_no_query()
    with Session(get_engine()) as session, session.begin():
        categories = session.scalars(select(Product.category).distinct().order_by(Product.category))
        category_values = list(categories)
        material_values = list(
            session.scalars(select(Product.material).distinct().order_by(Product.material))
        )
        bounds = session.execute(
            select(
                func.min(Product.price_jpy),
                func.max(Product.price_jpy),
                func.min(Product.width_cm),
                func.max(Product.width_cm),
                func.min(Product.depth_cm),
                func.max(Product.depth_cm),
                func.min(Product.height_cm),
                func.max(Product.height_cm),
            )
        ).one()
    return jsonify(
        data={
            "categories": category_values,
            "materials": material_values,
            "price_jpy": {"min": bounds[0], "max": bounds[1]},
            "dimensions_cm": {
                "width": {"min": bounds[2], "max": bounds[3]},
                "depth": {"min": bounds[4], "max": bounds[5]},
                "height": {"min": bounds[6], "max": bounds[7]},
            },
        }
    )


@api.get("/products")
def products() -> Response:
    query = parse_catalog_query()
    predicates: list[ColumnElement[bool]] = []
    if query.category:
        predicates.append(Product.category.in_(query.category))
    if query.material:
        predicates.append(Product.material.in_(query.material))
    if query.min_price is not None:
        predicates.append(Product.price_jpy >= query.min_price)
    if query.max_price is not None:
        predicates.append(Product.price_jpy <= query.max_price)
    if query.max_width is not None:
        predicates.append(Product.width_cm <= query.max_width)
    for term in query.q.split():
        predicates.append(func.instr(Product.search_text, term) > 0)
    sort_options: dict[str, ColumnElement[Any]] = {
        "featured": Product.display_order.asc(),
        "price_asc": Product.price_jpy.asc(),
        "price_desc": Product.price_jpy.desc(),
        "title_asc": Product.title_sort_key.asc(),
    }
    primary_order = sort_options[query.sort]
    statement = (
        select(Product)
        .where(*predicates)
        .order_by(primary_order, Product.id.asc())
        .offset((query.page - 1) * query.page_size)
        .limit(query.page_size)
    )
    with Session(get_engine()) as session, session.begin():
        total = session.scalar(select(func.count()).select_from(Product).where(*predicates)) or 0
        data = [product_summary(product) for product in session.scalars(statement)]
    return jsonify(
        data=data,
        meta={
            "page": query.page,
            "page_size": query.page_size,
            "total": total,
            "total_pages": (total + query.page_size - 1) // query.page_size,
        },
    )
