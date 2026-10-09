"""Dependency-free BM25 approximation; NOT a MiniSearch parity implementation."""
from __future__ import annotations

import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

from benchmark import EvalError, read_json

RETRIEVER = "python-bm25-approx-v1"
FIELDS = {"title": 3.0, "category": 1.5, "text": 1.0}
# Mirrors frontend/src/lib/knowledge.ts: general reference packs rank below the team-written guides.
REFERENCE_PACKS = {"wikipedia-essentials", "wikipedia-prepared", "wikipedia-full"}
REFERENCE_WEIGHT = 0.4


def tokens(text: str) -> list[str]:
    # Production expandQuery uses Unicode letters/numbers and lowercase.
    return re.findall(r"[^\W_]+", text.lower(), re.UNICODE)


def load_taglish(path: Path) -> dict[str, str]:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise EvalError(f"Cannot read Taglish source {path}: {exc}") from exc
    match = re.search(r"const\s+TAGLISH[^=]*=\s*\{(.*?)\};", source, re.S)
    if not match:
        raise EvalError(f"{path}: cannot extract TAGLISH map; update the eval extractor")
    body = re.sub(r"//[^\n]*", "", match[1])
    pairs = re.findall(r"([\w-]+)\s*:\s*'([^'\\]*)'\s*,?", body)
    remainder = re.sub(r"[\w-]+\s*:\s*'[^'\\]*'\s*,?", "", body)
    if not pairs or remainder.strip():
        raise EvalError(f"{path}: TAGLISH must contain plain single-quoted string entries")
    return dict(pairs)


def expand_query(query: str, taglish: dict[str, str]) -> list[str]:
    return tokens(" ".join(taglish.get(word, word) for word in tokens(query)))


def js_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def chunk_article(pack: dict[str, Any], article: dict[str, Any]) -> list[dict[str, Any]]:
    output = []
    buffer = ""

    def flush() -> None:
        nonlocal buffer
        if buffer.strip():
            output.append({"id": f"{pack['id']}/{article['id']}#{len(output)}", "packId": pack["id"], "articleId": article["id"], "title": article["title"], "category": article["category"], "text": buffer.strip(), "source": article.get("source", "")})
        buffer = ""

    for paragraph in re.split(r"\n\s*\n", article["text"]):
        if buffer and js_length(buffer) + js_length(paragraph) > 600:
            flush()
        buffer += ("\n\n" if buffer else "") + paragraph
    flush()
    return output


def load_packs(directory: Path, selected: list[str] | None = None) -> tuple[list[dict[str, Any]], list[Path]]:
    if not directory.is_dir():
        raise EvalError(f"Knowledge directory does not exist: {directory}")
    # sizes.json (pack size index from the Node builder) lives next to the packs but is not a pack
    files = sorted(p for p in directory.glob("*.json") if p.name != "sizes.json")
    if selected:
        files = [directory / f"{pack}.json" for pack in selected]
    if not files:
        raise EvalError(f"No JSON knowledge packs in {directory}")
    passages = []
    pack_ids: set[str] = set()
    for path in files:
        pack = read_json(path)
        if not isinstance(pack, dict) or not isinstance(pack.get("id"), str) or not pack["id"] or not isinstance(pack.get("articles"), list):
            raise EvalError(f"{path}: expected a pack with a string id and articles array")
        if pack["id"] in pack_ids:
            raise EvalError(f"{path}: duplicate pack ID {pack['id']!r}")
        pack_ids.add(pack["id"])
        article_ids: set[str] = set()
        for index, article in enumerate(pack["articles"]):
            if not isinstance(article, dict) or any(not isinstance(article.get(field), str) or not article[field].strip() for field in ("id", "title", "category", "text")):
                raise EvalError(f"{path}: article[{index}] needs nonempty id/title/category/text")
            if article["id"] in article_ids or not isinstance(article.get("source", ""), str):
                raise EvalError(f"{path}: article[{index}] has duplicate ID or invalid source")
            article_ids.add(article["id"])
            passages.extend(chunk_article(pack, article))
    if not passages:
        raise EvalError("Knowledge packs contain no passages")
    return passages, files


def edit_distance(left: str, right: str, limit: int) -> int:
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        current = [i]
        for j, b in enumerate(right, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a != b)))
        if min(current) > limit:
            return limit + 1
        previous = current
    return previous[-1]


class Retriever:
    def __init__(self, passages: list[dict[str, Any]], taglish: dict[str, str]):
        self.passages = passages
        self.taglish = taglish
        self.documents = [{field: Counter(tokens(p[field])) for field in FIELDS} for p in passages]
        self.df = {field: Counter(term for doc in self.documents for term in doc[field]) for field in FIELDS}
        self.average = {field: sum(sum(doc[field].values()) for doc in self.documents) / len(self.documents) for field in FIELDS}
        self.vocabulary = sorted(set(term for frequencies in self.df.values() for term in frequencies))

    def search(self, query: str, top_k: int) -> list[dict[str, Any]]:
        scores = [0.0] * len(self.documents)
        for word in dict.fromkeys(expand_query(query, self.taglish)):
            limit = math.floor(len(word) * 0.15)
            matches = []
            for term in self.vocabulary:
                if term == word:
                    matches.append((term, 1.0))
                elif term.startswith(word):
                    matches.append((term, 0.8))
                elif limit and edit_distance(word, term, limit) <= limit:
                    matches.append((term, 0.6))
            for term, discount in matches:
                for field, boost in FIELDS.items():
                    frequency = self.df[field][term]
                    if not frequency:
                        continue
                    idf = math.log(1 + (len(self.documents) - frequency + 0.5) / (frequency + 0.5))
                    for index, doc in enumerate(self.documents):
                        tf = doc[field][term]
                        if tf:
                            length = sum(doc[field].values())
                            norm = 1.2 * (0.25 + 0.75 * length / (self.average[field] or 1))
                            scores[index] += boost * discount * idf * tf * 2.2 / (tf + norm)
        scores = [score * (REFERENCE_WEIGHT if self.passages[i]["packId"] in REFERENCE_PACKS else 1.0) for i, score in enumerate(scores)]
        indices = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
        return [{**self.passages[i], "score": round(scores[i], 6)} for i in indices[:top_k] if scores[i] > 0]
