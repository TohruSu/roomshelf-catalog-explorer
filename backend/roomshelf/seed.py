import random
from typing import Any

from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from .db import check_schema
from .models import AVAILABILITIES, CATEGORIES, COLORS, MATERIALS, Product
from .normalization import normalize_text

SEED = 2026
PRODUCT_COUNT = 144

NAMES = ("Arc", "Cedarline", "Dune", "Fold", "Hollow", "Linden", "Pebble", "Reed")
DESCRIPTIONS = {
    "bed": "A low bed frame with a clear outline and room for a quiet bedside arrangement.",
    "chair": "A compact chair with a gently angled back for a reading corner or dining table.",
    "desk": "A straightforward desk with an open work surface and space beneath for a chair.",
    "sofa": "A softly outlined sofa with a generous seat for a relaxed living space.",
    "storage": "An upright storage piece with balanced proportions for everyday household objects.",
    "table": "A simple table with an uncluttered surface for meals, projects, or an evening book.",
}
DIMENSIONS = {
    "bed": ((90, 200), (185, 210), (35, 100)),
    "chair": ((40, 80), (44, 70), (70, 105)),
    "desk": ((75, 180), (40, 85), (68, 80)),
    "sofa": ((90, 220), (70, 110), (65, 95)),
    "storage": ((30, 140), (28, 60), (45, 190)),
    "table": ((55, 180), (45, 95), (40, 85)),
}


class SeedConflict(Exception):
    pass


def seed_records() -> list[dict[str, Any]]:
    generator = random.Random(SEED)
    records: list[dict[str, Any]] = []
    for category in CATEGORIES:
        for offset in range(PRODUCT_COUNT // len(CATEGORIES)):
            product_id = len(records) + 1
            name = NAMES[offset % len(NAMES)]
            title = f"{name} {category.title()} {offset + 1:02d}"
            material = MATERIALS[(offset + CATEGORIES.index(category)) % len(MATERIALS)]
            color = COLORS[generator.randrange(len(COLORS))]
            description = f"{DESCRIPTIONS[category]} Its primary material is {material}."
            dimensions = DIMENSIONS[category]
            records.append(
                {
                    "id": product_id,
                    "slug": f"{name.lower()}-{category}-{product_id:03d}",
                    "title": title,
                    "category": category,
                    "material": material,
                    "color": color,
                    "description": description,
                    "price_jpy": generator.randrange(45, 2481) * 100,
                    "width_cm": generator.randint(*dimensions[0]),
                    "depth_cm": generator.randint(*dimensions[1]),
                    "height_cm": generator.randint(*dimensions[2]),
                    "availability": AVAILABILITIES[offset % len(AVAILABILITIES)],
                    "illustration_key": f"{category}-01",
                    "display_order": offset * len(CATEGORIES) + CATEGORIES.index(category),
                    "title_sort_key": normalize_text(title),
                    "search_text": normalize_text(f"{title} {description}"),
                }
            )
    return records


def seed_database(engine: Engine, *, reset: bool = False) -> int:
    check_schema(engine)
    records = seed_records()
    with Session(engine) as session, session.begin():
        if reset:
            session.execute(delete(Product))
            existing: list[Product] = []
        else:
            existing = list(session.scalars(select(Product)))
        by_id = {product.id: product for product in existing}
        by_slug = {product.slug: product for product in existing}
        for record in records:
            id_match = by_id.get(record["id"])
            slug_match = by_slug.get(record["slug"])
            if (id_match is not None and id_match.slug != record["slug"]) or (
                slug_match is not None and slug_match.id != record["id"]
            ):
                raise SeedConflict(
                    f"Seed identity conflict for product {record['id']}; no rows were changed."
                )
        inserted = 0
        for record in records:
            if record["id"] not in by_id:
                session.add(Product(**record))
                inserted += 1
    return inserted
