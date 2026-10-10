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


def production_prompt(path: Path, name: str = "SYSTEM") -> str:
    """Resolve known template constants/bare ${NAME} references, never execute TS."""
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise EvalError(f"Cannot read production prompt {path}: {exc}") from exc
    def fail(detail: str):
        raise EvalError(f"{path}: unsupported frontend prompt {name}: {detail}; expected template constants and bare ${{NAME}} references, or use --prompt")

    def resolve(identifier: str, stack: tuple[str, ...]) -> str:
        if identifier in stack or len(stack) >= 20:
            fail(f"cyclic or excessive composition at {identifier}")
        declarations = list(re.finditer(rf"^[ \t]*(?:export\s+)?const\s+{re.escape(identifier)}\s*=\s*", source, re.M))
        if len(declarations) != 1:
            fail(f"missing or duplicate constant {identifier}")
        cursor = declarations[0].end()
        if cursor >= len(source) or source[cursor] != '`':
            fail(f"{identifier} must be a template literal")
        cursor += 1
        output = []
        escapes = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "`": "`", "$": "$"}
        while cursor < len(source):
            char = source[cursor]
            if char == '`':
                if not source[cursor + 1:].lstrip().startswith(';'):
                    fail(f"expression after {identifier}'s template")
                return ''.join(output)
            if char == '\\':
                cursor += 1
                if cursor >= len(source) or source[cursor] not in escapes:
                    fail(f"unsupported escape in {identifier}")
                output.append(escapes[source[cursor]])
            elif source.startswith('${', cursor):
                end = source.find('}', cursor + 2)
                reference = source[cursor + 2:end].strip() if end >= 0 else ''
                if not re.fullmatch(r"[A-Za-z_]\w*", reference):
                    fail(f"unsupported interpolation in {identifier}")
                output.append(resolve(reference, (*stack, identifier)))
                cursor = end
            else:
                output.append(char)
            cursor += 1
        fail(f"unterminated template {identifier}")

    return resolve(name, ())


def build_messages(system: str, question: str, references: list[dict[str, Any]], rag: bool,
                   general_system: str | None = None) -> list[dict[str, str]]:
    if rag and references:
        reference_text = "\n\n".join(f"## {p['title']}\n{p['text']}" for p in references)
        user = f"Reference information:\n{reference_text}\n\nQuestion: {question}"
    else:
        user = question
        if general_system is not None:
            system = general_system
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
