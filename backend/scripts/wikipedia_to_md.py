"""Fetch a curated list of Wikipedia articles and write them as a CollapseAI pack (Markdown).

Usage (from the repository root, needs internet):
    python backend/scripts/wikipedia_to_md.py     # reads backend/scripts/wikipedia_articles.json
    npm run packs                                 # builds frontend/public/packs/wikipedia.json

Text is plain text from the MediaWiki API (CC BY-SA 4.0). Every article keeps its page link,
revision number and date in `source:`. Only the Python standard library is used.
Wikipedia is NOT medical guidance: review the output before relying on it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "CollapseAI-pack-builder/0.1 (offline survival hackathon project; https://github.com/jampolygon/collapseAI)"
DROP_SECTIONS = {
    "references", "external links", "see also", "further reading", "notes", "bibliography", "sources",
    "citations", "footnotes", "general references", "cited sources", "works cited", "gallery",
    "in popular culture", "in fiction", "in literature", "etymology", "notable examples", "notable events", "records",
}
PASSAGE_TARGET = 520  # well under the pack builder's 1000-character passage limit


def fetch(title: str) -> dict | None:
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "prop": "extracts|revisions", "explaintext": "1", "exsectionformat": "wiki", "rvprop": "ids|timestamp",
        "titles": title,
    })
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    page = (data.get("query", {}).get("pages") or [None])[0]
    if not page or page.get("missing") or not page.get("extract"):
        return None
    revision = (page.get("revisions") or [{}])[0]
    return {"title": page["title"], "text": page["extract"], "revid": revision.get("revid"), "timestamp": revision.get("timestamp", "")}


def split_sentences(paragraph: str) -> list[str]:
    """Break one long paragraph into pieces of at most ~PASSAGE_TARGET characters, on sentence ends."""
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"(])", paragraph)
    pieces: list[str] = []
    buffer = ""
    for sentence in sentences:
        while len(sentence) > PASSAGE_TARGET:  # one huge sentence: cut at a space
            cut = sentence.rfind(" ", 0, PASSAGE_TARGET)
            cut = cut if cut > 100 else PASSAGE_TARGET
            if buffer:
                pieces.append(buffer)
                buffer = ""
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if buffer and len(buffer) + len(sentence) + 1 > PASSAGE_TARGET:
            pieces.append(buffer)
            buffer = ""
        buffer = f"{buffer} {sentence}".strip()
    if buffer:
        pieces.append(buffer)
    return pieces


def clean(text: str, max_chars: int) -> str:
    """Plain Wikipedia text -> Markdown body: bold section names, no reference sections, short paragraphs."""
    blocks: list[str] = []
    skipping = False
    size = 0
    done = False
    for line in text.replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        heading = re.fullmatch(r"(={2,6})\s*(.+?)\s*\1", line)
        if heading:
            name = heading[2].strip()
            skipping = name.lower() in DROP_SECTIONS or name.lower().startswith("list of")
            if not skipping:
                blocks.append(f"**{name}**")
            continue
        if skipping or "\\displaystyle" in line or "{{" in line or len(line) < 3:
            continue
        line = re.sub(r"\s+", " ", line).replace("​", "")
        for piece in split_sentences(line):
            if size + len(piece) > max_chars:
                done = True
                break
            blocks.append(piece)
            size += len(piece)
        if done:
            break
    # a bold heading with nothing after it is noise
    kept = [b for i, b in enumerate(blocks) if not (b.startswith("**") and (i + 1 == len(blocks) or blocks[i + 1].startswith("**")))]
    return "\n\n".join(kept).strip()


def build(entries: list[dict], max_chars: int, pause: float) -> tuple[str, list[str]]:
    today = date.today().isoformat()
    lines = [
        "---", "id: wikipedia", "name: Wikipedia Essentials",
        "license: CC BY-SA 4.0. Text from Wikipedia contributors (en.wikipedia.org); each article links to its page and history.",
        "version: 1", f"updated: {today}", f"last_verified: {today}", "---", "",
    ]
    missing: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        title = entry["title"]
        try:
            page = fetch(title)
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            missing.append(f"{title} ({exc})")
            continue
        time.sleep(pause)
        if not page:
            missing.append(f"{title} (no such page)")
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", page["title"].lower()).strip("-")
        body = clean(page["text"], max_chars)
        if slug in seen or len(body) < 200:
            missing.append(f"{title} (duplicate or too short)")
            continue
        seen.add(slug)
        url = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_"))
        lines += [
            f"# {page['title']}", f"category: {entry.get('category', 'Wikipedia')}",
            f"source: Wikipedia, \"{page['title']}\" (revision {page['revid']}, {page['timestamp'][:10]}), CC BY-SA 4.0, {url}",
        ]
        if entry.get("tags"):
            lines.append(f"tags: {entry['tags']}")
        if entry.get("disaster_types"):
            lines.append(f"disaster_types: {entry['disaster_types']}")
        lines += [f"last_verified: {today}", "", body, ""]
        print(f"ok  {page['title']}: {len(body)} chars")
    return "\n".join(lines).rstrip() + "\n", missing


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--list", type=Path, default=HERE / "wikipedia_articles.json")
    cli.add_argument("--out", type=Path, default=ROOT / "backend/content/wikipedia.md")
    cli.add_argument("--max-chars", type=int, default=6000, help="maximum body characters per article")
    cli.add_argument("--pause", type=float, default=0.3, help="seconds between requests (be polite to Wikipedia)")
    args = cli.parse_args(argv)
    entries = json.loads(args.list.read_text(encoding="utf-8"))["articles"]
    markdown, missing = build(entries, args.max_chars, args.pause)
    args.out.write_text(markdown, encoding="utf-8", newline="\n")
    print(f"wrote {args.out} ({len(markdown)} bytes)")
    for item in missing:
        print(f"skipped: {item}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
