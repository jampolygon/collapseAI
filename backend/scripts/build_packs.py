"""Pack Builder v2: validated Markdown/JSON -> unchanged pack schema + resource manifest.

Usage: python backend/scripts/build_packs.py --help
No network requests or third-party Python dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend/content"
OUT = ROOT / "frontend/public/packs"
CATALOG = ROOT / "frontend/src/lib/catalog.ts"
BUILDER_VERSION = 2
CHUNK_TARGET = 600  # Mirror knowledge.ts; this is a target, not a hard bound.
DEFAULT_MAX_PASSAGE = 1000
DEFAULT_MAX_ARTICLE = 20000
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class BuildError(Exception):
    """A source or output error with enough context to fix the offending file."""


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise BuildError(f"{path}: cannot read UTF-8 content: {exc}") from exc


def strict_json(text: str, location: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise BuildError(f"{location}: duplicate JSON field {key!r}")
            result[key] = value
        return result

    def constant(value: str) -> None:
        raise BuildError(f"{location}: non-finite JSON value {value}")

    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except json.JSONDecodeError as exc:
        raise BuildError(f"{location}:{exc.lineno}:{exc.colno}: malformed JSON: {exc.msg}") from exc


def nonempty(value: Any, field: str, location: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BuildError(f"{location}: {field} must be a non-empty string")
    return value


def js_length(text: str) -> int:
    try:
        return len(text.encode("utf-16-le")) // 2
    except UnicodeError as exc:
        raise BuildError("Text contains an invalid Unicode surrogate") from exc


def passage_texts(text: str) -> list[str]:
    """Reproduce production paragraph chunk boundaries, including long paragraphs."""
    output = []
    buffer = ""
    for paragraph in re.split(r"\n\s*\n", text):
        if buffer and js_length(buffer) + js_length(paragraph) > CHUNK_TARGET:
            if buffer.strip():
                output.append(buffer.strip())
            buffer = ""
        buffer += ("\n\n" if buffer else "") + paragraph
    if buffer.strip():
        output.append(buffer.strip())
    return output


def validate_pack(pack: Any, location: str, max_passage_chars: int = DEFAULT_MAX_PASSAGE,
                  max_article_chars: int = DEFAULT_MAX_ARTICLE) -> None:
    if max_passage_chars < 1 or max_article_chars < 1:
        raise BuildError("Content limits must be positive integers")
    if not isinstance(pack, dict):
        raise BuildError(f"{location}: pack must be an object")
    pack_id = nonempty(pack.get("id"), "pack id", location)
    if not SLUG.fullmatch(pack_id):
        raise BuildError(f"{location}: invalid pack id {pack_id!r}; use lowercase ASCII hyphenated slugs")
    nonempty(pack.get("name"), "pack name", location)
    version = pack.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise BuildError(f"{location}: version must be a positive integer")
    if "license" in pack and not isinstance(pack["license"], str):
        raise BuildError(f"{location}: license must be a string")
    articles = pack.get("articles")
    if not isinstance(articles, list):
        raise BuildError(f"{location}: articles must be an array")
    if not articles:
        raise BuildError(f"{location}: articles must not be empty")
    seen: set[str] = set()
    for index, article in enumerate(articles):
        where = f"{location}: article[{index}]"
        if not isinstance(article, dict):
            raise BuildError(f"{where}: article must be an object")
        for field in ("id", "title", "category", "text"):
            nonempty(article.get(field), field, where)
        article_id = article["id"]
        where += f" ({article_id})"
        if not SLUG.fullmatch(article_id):
            raise BuildError(f"{where}: invalid article id; use a lowercase ASCII hyphenated slug")
        if article_id in seen:
            raise BuildError(f"{where}: duplicate article ID/slug {article_id!r}")
        seen.add(article_id)
        if "source" in article and not isinstance(article["source"], str):
            raise BuildError(f"{where}: source must be a string when present")
        try:
            size = js_length(article["text"])
            chunks = passage_texts(article["text"])
        except BuildError as exc:
            raise BuildError(f"{where}: {exc}") from exc
        if size > max_article_chars:
            raise BuildError(f"{where}: content length {size} exceeds --max-article-chars {max_article_chars}")
        for chunk_index, chunk in enumerate(chunks):
            length = js_length(chunk)
            if length > max_passage_chars:
                raise BuildError(f"{where}: passage #{chunk_index} has {length} UTF-16 characters, exceeding --max-passage-chars {max_passage_chars}; split long paragraphs with blank lines")


def parse(path: Path, max_passage_chars: int = DEFAULT_MAX_PASSAGE,
          max_article_chars: int = DEFAULT_MAX_ARTICLE) -> dict[str, Any]:
    text = read_text(path)
    if path.suffix.lower() == ".json":
        pack = strict_json(text, str(path))
        validate_pack(pack, str(path), max_passage_chars, max_article_chars)
        return pack
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise BuildError(f"{path}:1: missing opening --- header")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise BuildError(f"{path}:1: missing closing --- header")
    meta: dict[str, str] = {}
    for index in range(1, end):
        line = lines[index].strip()
        if not line:
            continue
        if ":" not in line:
            raise BuildError(f"{path}:{index + 1}: malformed header; expected key: value")
        key, value = (part.strip() for part in line.split(":", 1))
        if key not in {"id", "name", "license", "version", "keywords", "updated", "last_verified"}:
            raise BuildError(f"{path}:{index + 1}: unknown header field {key!r}")
        if key in meta:
            raise BuildError(f"{path}:{index + 1}: duplicate header field {key!r}")
        meta[key] = value
    try:
        version = int(meta.get("version", "1"))
    except ValueError as exc:
        raise BuildError(f"{path}: version header must be a positive integer") from exc
    body = lines[end + 1:]
    headings = [i for i, line in enumerate(body) if re.match(r"^#(?:\s|$)", line)]
    if not headings:
        raise BuildError(f"{path}: no # Article title headings")
    if any(line.strip() for line in body[:headings[0]]):
        raise BuildError(f"{path}:{end + 2}: unexpected content before the first article heading")
    articles = []
    seen: dict[str, int] = {}
    for position, start in enumerate(headings):
        stop = headings[position + 1] if position + 1 < len(headings) else len(body)
        line_number = end + 2 + start
        title = body[start][1:].strip()
        nonempty(title, "article title", f"{path}:{line_number}")
        article_id = slug(title)
        nonempty(article_id, "generated article id", f"{path}:{line_number}")
        if article_id in seen:
            raise BuildError(f"{path}:{line_number}: duplicate article ID/slug {article_id!r} (first heading at line {seen[article_id]})")
        seen[article_id] = line_number
        fields: dict[str, str] = {}
        cursor = start + 1
        while cursor < stop and re.match(r"^(category|source|tags|disaster_types|last_verified):", body[cursor]):
            key, value = body[cursor].split(":", 1)
            if key in fields:
                raise BuildError(f"{path}:{end + 2 + cursor}: duplicate article field {key!r}")
            fields[key] = value.strip()
            cursor += 1
        nonempty(fields.get("category"), "category", f"{path}:{line_number} ({article_id})")
        article = {"id": article_id, "title": title, "category": fields["category"], "source": fields.get("source", "")}
        for key in ("tags", "disaster_types"):
            if fields.get(key):
                article[key] = [value.strip() for value in fields[key].split(",") if value.strip()]
        if fields.get("last_verified") or meta.get("last_verified"):
            article["last_verified"] = fields.get("last_verified") or meta["last_verified"]
        article["text"] = "\n".join(body[cursor:stop]).strip()
        articles.append(article)
    pack = {"id": meta.get("id"), "name": meta.get("name"), "version": version,
            "license": meta.get("license", "")}
    if meta.get("keywords"):
        pack["keywords"] = [value.strip() for value in meta["keywords"].split(",") if value.strip()]
    # Keep the existing Node format for sources that opted into its metadata.
    # Prefer explicit source dates so unchanged content builds deterministically.
    if meta.get("updated") or meta.get("last_verified"):
        pack["updated"] = meta.get("updated") or meta["last_verified"]
    pack["articles"] = articles
    validate_pack(pack, str(path), max_passage_chars, max_article_chars)
    return pack


def catalog_models(path: Path) -> list[dict[str, Any]]:
    """Read the current catalog's literal entries; fail explicitly on unsupported syntax."""
    text = read_text(path)
    array = re.search(r"export\s+const\s+MODELS\s*:[^=]*=\s*\[(.*?)^\];", text, re.S | re.M)
    if not array:
        raise BuildError(f"{path}: cannot extract MODELS array")
    pattern = re.compile(r"^  \{(.*?)^  \},?\s*$", re.S | re.M)
    blocks = list(pattern.finditer(array[1]))
    if not blocks or pattern.sub("", array[1]).strip():
        raise BuildError(f"{path}: unsupported MODELS layout; expected the existing literal catalog entries")
    hf = re.search(r"const\s+HF\s*=\s*'([^'\\]+)'", text)
    models = []
    seen: set[str] = set()
    for index, block in enumerate(blocks):
        where = f"{path}: model[{index}]"
        model_id = re.search(r"^\s*id:\s*'([^'\\]+)'\s*,?\s*$", block[1], re.M)
        name = re.search(r"^\s*name:\s*'([^'\\]+)'\s*,?\s*$", block[1], re.M)
        url_match = re.search(r"^\s*url:\s*([`'])(.*?)\1\s*,?\s*$", block[1], re.M)
        if not model_id or not name or not url_match:
            raise BuildError(f"{where}: id/name/url must use supported literal strings")
        identifier = model_id[1]
        if not re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)*", identifier) or identifier in seen:
            raise BuildError(f"{where}: invalid or duplicate model ID {identifier!r}")
        seen.add(identifier)
        url = url_match[2]
        if "${HF}" in url:
            if not hf:
                raise BuildError(f"{where}: missing literal HF base URL")
            url = url.replace("${HF}", hf[1])
        try:
            parsed = urlsplit(url)
        except ValueError as exc:
            raise BuildError(f"{where}: invalid model URL: {exc}") from exc
        if "${" in url or "\\" in url or any(c.isspace() for c in url) or parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise BuildError(f"{where}: URL cannot be resolved to a literal http(s) address")
        models.append({"id": identifier, "name": name[1], "url": url, "size": None, "sha256": None})
    return models


def serialize(data: Any, indent: int, location: str) -> bytes:
    try:
        return json.dumps(data, ensure_ascii=False, indent=indent, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise BuildError(f"{location}: invalid JSON output: {exc}") from exc


def atomic_write(path: Path, data: bytes) -> None:
    """Replace one file only after verifying the temporary bytes match exactly."""
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
        if temporary.read_bytes() != data:
            raise BuildError(f"{path}: invalid/truncated staged output")
        temporary.replace(path)
        if path.read_bytes() != data:
            raise BuildError(f"{path}: invalid/truncated published output")
    except OSError as exc:
        raise BuildError(f"{path}: cannot write output: {exc}") from exc
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def build(source_dir: Path = SRC, output_dir: Path = OUT, manifest_path: Path | None = None,
          catalog: Path = CATALOG, max_passage_chars: int = DEFAULT_MAX_PASSAGE,
          max_article_chars: int = DEFAULT_MAX_ARTICLE) -> dict[str, Any]:
    manifest_path = manifest_path or output_dir.parent / "manifest.json"
    if not source_dir.is_dir():
        raise BuildError(f"{source_dir}: source directory does not exist")
    files = sorted(path for path in source_dir.iterdir() if path.is_file() and path.suffix.lower() in {".md", ".json"})
    if not files:
        raise BuildError(f"{source_dir}: no Markdown or JSON source files")
    resources = []
    payloads: dict[Path, bytes] = {}
    seen: dict[str, Path] = {}
    errors = []
    # Validate the whole source set before modifying any output file.
    for source in files:
        try:
            pack = parse(source, max_passage_chars, max_article_chars)
            if pack["id"] in seen:
                raise BuildError(f"{source}: duplicate pack ID {pack['id']!r}; already defined by {seen[pack['id']]}")
            seen[pack["id"]] = source
            target = output_dir / f"{pack['id']}.json"
            payload = serialize(pack, 1, str(target))
            round_trip = strict_json(payload.decode("utf-8"), str(target))
            validate_pack(round_trip, str(target), max_passage_chars, max_article_chars)
            if round_trip != pack:
                raise BuildError(f"{target}: JSON round-trip changed the pack")
            payloads[target] = payload
            resources.append({"id": pack["id"], "path": f"/packs/{pack['id']}.json", "size": len(payload),
                              "sha256": hashlib.sha256(payload).hexdigest(), "articles": len(pack["articles"]), "version": pack["version"]})
        except BuildError as exc:
            errors.append(str(exc))
    if errors:
        raise BuildError("Source validation failed:\n" + "\n".join(f"- {error}" for error in errors))
    models = catalog_models(catalog)
    resources.sort(key=lambda item: item["id"])
    manifest = {"schema_version": 1, "builder_version": BUILDER_VERSION, "packs": resources, "models": models}
    manifest_bytes = serialize(manifest, 2, str(manifest_path)) + b"\n"
    if strict_json(manifest_bytes.decode("utf-8"), str(manifest_path)) != manifest:
        raise BuildError(f"{manifest_path}: invalid manifest round-trip")
    if manifest_path.resolve() in {path.resolve() for path in payloads}:
        raise BuildError(f"{manifest_path}: manifest path conflicts with a pack output")
    for target, payload in payloads.items():
        atomic_write(target, payload)
        print(f"{target}: {len(payload)} bytes")
    # Publish the manifest last, checking hashes/sizes against the actual files.
    for entry in resources:
        raw = (output_dir / f"{entry['id']}.json").read_bytes()
        if len(raw) != entry["size"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise BuildError(f"{entry['id']}: published pack size/hash mismatch; manifest not written")
    atomic_write(manifest_path, manifest_bytes)
    print(f"{manifest_path}: {len(resources)} packs, {len(models)} catalog models")
    return manifest


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def main(argv: list[str] | None = None) -> int:
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    cli.add_argument("--source-dir", type=Path, default=SRC, help="Markdown and/or JSON pack sources")
    cli.add_argument("--output-dir", type=Path, default=OUT, help="generated pack JSON directory")
    cli.add_argument("--manifest", type=Path, help="resource manifest path; default: output directory's parent/manifest.json")
    cli.add_argument("--catalog", type=Path, default=CATALOG, help="TypeScript catalog for model IDs and URLs (read only)")
    cli.add_argument("--max-passage-chars", type=positive_int, default=DEFAULT_MAX_PASSAGE, help="hard limit for production-style passages, measured in UTF-16 code units")
    cli.add_argument("--max-article-chars", type=positive_int, default=DEFAULT_MAX_ARTICLE, help="hard limit for full article text, measured in UTF-16 code units")
    args = cli.parse_args(argv)
    try:
        build(args.source_dir, args.output_dir, args.manifest, args.catalog, args.max_passage_chars, args.max_article_chars)
        return 0
    except (BuildError, OSError) as exc:
        print(f"Pack build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
