from typing import Literal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .normalization import normalize_text
from .slugs import validate_slug

Category = Literal["bed", "chair", "desk", "sofa", "storage", "table"]
Material = Literal["fabric", "glass", "metal", "mixed", "wood"]
CATEGORIES: tuple[Category, ...] = ("bed", "chair", "desk", "sofa", "storage", "table")
MATERIALS: tuple[Material, ...] = ("fabric", "glass", "metal", "mixed", "wood")
COLORS = ("natural", "ivory", "charcoal", "sage", "terracotta")
AVAILABILITIES = ("in_stock", "made_to_order", "unavailable")
MAX_INTEGER = 2_147_483_647


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("length(slug) BETWEEN 1 AND 80", name="product_slug_length"),
        CheckConstraint("length(trim(title)) BETWEEN 1 AND 120", name="product_title_length"),
        CheckConstraint(
            "length(trim(description)) BETWEEN 1 AND 2000", name="product_description_length"
        ),
        CheckConstraint(
            "category IN ('bed', 'chair', 'desk', 'sofa', 'storage', 'table')",
            name="product_category",
        ),
        CheckConstraint(
            "material IN ('fabric', 'glass', 'metal', 'mixed', 'wood')", name="product_material"
        ),
        CheckConstraint(
            "color IN ('natural', 'ivory', 'charcoal', 'sage', 'terracotta')", name="product_color"
        ),
        CheckConstraint(
            "availability IN ('in_stock', 'made_to_order', 'unavailable')",
            name="product_availability",
        ),
        CheckConstraint(
            "typeof(price_jpy) = 'integer' AND price_jpy BETWEEN 0 AND 2147483647",
            name="product_price",
        ),
        CheckConstraint(
            "typeof(width_cm) = 'integer' AND width_cm BETWEEN 1 AND 1000", name="product_width"
        ),
        CheckConstraint(
            "typeof(depth_cm) = 'integer' AND depth_cm BETWEEN 1 AND 1000", name="product_depth"
        ),
        CheckConstraint(
            "typeof(height_cm) = 'integer' AND height_cm BETWEEN 1 AND 1000", name="product_height"
        ),
        CheckConstraint(
            "typeof(display_order) = 'integer' AND display_order >= 0", name="product_display_order"
        ),
        CheckConstraint("length(title_sort_key) > 0", name="product_title_sort_key"),
        CheckConstraint("length(search_text) > 0", name="product_search_text"),
        CheckConstraint(
            "illustration_key IN ('bed-01', 'chair-01', 'desk-01', "
            "'sofa-01', 'storage-01', 'table-01')",
            name="product_illustration",
        ),
        Index("ix_products_category_id", "category", "id"),
        Index("ix_products_material_id", "material", "id"),
        Index("ix_products_price_id", "price_jpy", "id"),
        Index("ix_products_width_id", "width_cm", "id"),
        Index("ix_products_display_id", "display_order", "id"),
        Index("ix_products_title_id", "title_sort_key", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(20))
    material: Mapped[str] = mapped_column(String(20))
    color: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text)
    price_jpy: Mapped[int] = mapped_column(Integer)
    width_cm: Mapped[int] = mapped_column(Integer)
    depth_cm: Mapped[int] = mapped_column(Integer)
    height_cm: Mapped[int] = mapped_column(Integer)
    availability: Mapped[str] = mapped_column(String(20))
    illustration_key: Mapped[str] = mapped_column(String(20))
    display_order: Mapped[int] = mapped_column(Integer)
    title_sort_key: Mapped[str] = mapped_column(Text)
    search_text: Mapped[str] = mapped_column(Text)


@event.listens_for(Product, "before_insert")
@event.listens_for(Product, "before_update")
def normalize_product(_mapper: object, _connection: object, product: Product) -> None:
    validate_slug(product.slug)
    product.title_sort_key = normalize_text(product.title)
    product.search_text = normalize_text(f"{product.title} {product.description}")


class AnonymousShortlist(Base):
    __tablename__ = "anonymous_shortlists"
    __table_args__ = (
        CheckConstraint(
            "length(key) = 64 AND key NOT GLOB '*[^0-9a-f]*'", name="shortlist_key_format"
        ),
        Index("ix_anonymous_shortlists_expires", "expires_at"),
    )

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(27))
    updated_at: Mapped[str] = mapped_column(String(27))
    expires_at: Mapped[str] = mapped_column(String(27))


class ShortlistItem(Base):
    __tablename__ = "shortlist_items"
    __table_args__ = (Index("ix_shortlist_items_product", "product_id"),)

    shortlist_key: Mapped[str] = mapped_column(
        ForeignKey("anonymous_shortlists.key", ondelete="CASCADE", onupdate="RESTRICT"),
        primary_key=True,
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE", onupdate="RESTRICT"), primary_key=True
    )
    added_at: Mapped[str] = mapped_column(String(27))


Index(
    "ix_shortlist_items_order",
    ShortlistItem.shortlist_key,
    ShortlistItem.added_at.desc(),
    ShortlistItem.product_id,
)
