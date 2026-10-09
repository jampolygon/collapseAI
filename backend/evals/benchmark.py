"""Benchmark validation, production prompt extraction, and transparent text checks."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any


class EvalError(Exception):
    """An actionable input, server, or protocol error."""


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EvalError(f"Cannot read JSON {path}: {exc}") from exc


def validate_rule(rule: Any, location: str) -> None:
    if isinstance(rule, str) and rule.strip():
        return
    if isinstance(rule, dict) and set(rule) == {"any_of"}:
        choices = rule["any_of"]
        if isinstance(choices, list) and choices and all(isinstance(x, str) and x.strip() for x in choices):
            return
    if isinstance(rule, dict) and set(rule) == {"regex"} and isinstance(rule["regex"], str) and rule["regex"].strip():
        try:
            re.compile(rule["regex"], re.IGNORECASE)
            return
        except re.error as exc:
            raise EvalError(f"{location}: invalid regex: {exc}") from exc
    raise EvalError(f"{location}: use a nonempty string, {{\"any_of\": [strings]}}, or {{\"regex\": \"pattern\"}}")


def load_questions(path: Path) -> list[dict[str, Any]]:
    data = read_json(path)
    if not isinstance(data, list) or not data:
        raise EvalError(f"{path}: expected a nonempty JSON array of questions")
    ids: set[str] = set()
    for index, question in enumerate(data):
        location = f"{path}: question[{index}]"
        if not isinstance(question, dict):
            raise EvalError(f"{location}: expected an object")
        for field in ("id", "category", "language", "question", "expected_behavior"):
            if not isinstance(question.get(field), str) or not question[field].strip():
                raise EvalError(f"{location}: {field} must be a nonempty string")
        if question["id"] in ids:
            raise EvalError(f"{location}: duplicate ID {question['id']!r}")
        ids.add(question["id"])
        for field in ("must_include", "must_not_include"):
            if not isinstance(question.get(field), list):
                raise EvalError(f"{location}: {field} must be an array")
            for rule in question[field]:
                validate_rule(rule, f"{location}.{field}")
        if not isinstance(question.get("notes", ""), str):
            raise EvalError(f"{location}: notes must be a string")
        sources = question.get("expected_source_ids", [])
        if not isinstance(sources, list) or not all(isinstance(x, str) and x.strip() for x in sources):
            raise EvalError(f"{location}: expected_source_ids must be an array of article IDs")
    return data


def production_prompt(path: Path) -> str:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise EvalError(f"Cannot read production prompt {path}: {exc}") from exc
    match = re.search(r"const\s+SYSTEM\s*=\s*`([^`]+)`\s*;", source)
    if not match or "${" in match[1] or "\\" in match[1]:
        raise EvalError(f"{path}: SYSTEM is no longer a plain template literal; use --prompt with a UTF-8 text file")
    return match[1]


def build_messages(system: str, question: str, references: list[dict[str, Any]], rag: bool) -> list[dict[str, str]]:
    if rag:
        reference_text = "\n\n".join(f"## {p['title']}\n{p['text']}" for p in references)
        if not reference_text:
            # Matches the current fallback in frontend/src/lib/ask.ts. Kept explicit
            # because extracting the surrounding TS control flow would be brittle.
            reference_text = "No reference found. Give only safe, general advice and say that you are not sure."
        user = f"Reference information:\n{reference_text}\n\nQuestion: {question}"
    else:
        user = question
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())


def rule_matches(rule: Any, answer: str) -> bool:
    text = normalized(answer)
    if isinstance(rule, str):
        return normalized(rule).casefold() in text.casefold()
    if "any_of" in rule:
        return any(normalized(choice).casefold() in text.casefold() for choice in rule["any_of"])
    return re.search(rule["regex"], text, re.IGNORECASE) is not None


def check_answer(question: dict[str, Any], answer: str, finish_reason: str | None) -> list[str]:
    failed = []
    for field in ("must_include", "must_not_include"):
        for rule in question[field]:
            matches = rule_matches(rule, answer)
            if (field == "must_include" and not matches) or (field == "must_not_include" and matches):
                failed.append(f"{field}: {json.dumps(rule, ensure_ascii=False)}")
    if finish_reason == "length":
        failed.append("Answer truncated at the generation/context limit")
    return failed
