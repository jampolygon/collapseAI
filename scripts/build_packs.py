"""Build knowledge packs: content/*.md -> public/packs/*.json

Usage:  python scripts/build_packs.py

Markdown format (one file per pack):

    ---
    id: first-aid
    name: First Aid
    license: ...
    ---

    # Article title
    category: First aid
    source: Where it comes from

    Article text, paragraphs separated by blank lines...

Later: add builders for Wikipedia / Kiwix ZIM that output the same JSON shape.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content"
OUT = ROOT / "public" / "packs"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def parse(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        raise SystemExit(f"{path}: missing --- header ---")
    meta = dict(line.split(":", 1) for line in m.group(1).strip().splitlines())
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    body = text[m.end():]

    articles = []
    for block in re.split(r"^# ", body, flags=re.M)[1:]:
        lines = block.strip().splitlines()
        title = lines[0].strip()
        fields, i = {}, 1
        while i < len(lines) and re.match(r"^(category|source):", lines[i]):
            k, v = lines[i].split(":", 1)
            fields[k] = v.strip()
            i += 1
        articles.append(
            {
                "id": slug(title),
                "title": title,
                "category": fields.get("category", meta.get("name", "")),
                "source": fields.get("source", ""),
                "text": "\n".join(lines[i:]).strip(),
            }
        )
    return {"id": meta["id"], "name": meta["name"], "version": 1, "license": meta.get("license", ""), "articles": articles}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for md in sorted(SRC.glob("*.md")):
        pack = parse(md)
        dest = OUT / f"{pack['id']}.json"
        dest.write_text(json.dumps(pack, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{dest.relative_to(ROOT)}: {len(pack['articles'])} articles, {dest.stat().st_size / 1000:.1f} KB")


if __name__ == "__main__":
    main()
