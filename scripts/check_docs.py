"""Validate public Markdown JSON fences and local image references; no dependencies."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSON_FENCE = re.compile(r"^```json\s*\n(.*?)^```\s*$", re.MULTILINE | re.DOTALL)
IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def check(root: Path = ROOT) -> tuple[int, int]:
    examples = images = 0
    documents = [root / "README.md", root / "e2e/README.md", *sorted((root / "docs").rglob("*.md"))]
    for document in documents:
        source = document.read_text(encoding="utf-8")
        fences = list(JSON_FENCE.finditer(source))
        if len(fences) != len(re.findall(r"^```json\s*$", source, re.MULTILINE)):
            raise ValueError(f"{document.relative_to(root)}: unclosed JSON fence")
        for fence in fences:
            try:
                json.loads(fence[1])
            except ValueError as error:
                raise ValueError(f"{document.relative_to(root)}: invalid JSON: {error}") from error
            examples += 1
        for alt, target in IMAGE.findall(source):
            if not alt.strip():
                raise ValueError(f"{document.relative_to(root)}: image needs descriptive alt text")
            if "://" in target:
                raise ValueError(f"{document.relative_to(root)}: use local images")
            if not (document.parent / target).is_file():
                raise ValueError(f"{document.relative_to(root)}: missing image {target}")
            images += 1
    return examples, images


if __name__ == "__main__":
    examples, images = check()
    print(f"Documentation: {examples} valid JSON examples; {images} local images with alt text.")
