#!/usr/bin/env python3
"""Benchmark CollapseAI through llama-server; no third-party Python packages."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib import error, parse, request

from benchmark import EvalError, build_messages, check_answer, load_questions, production_prompt
from retrieval import RETRIEVER, Retriever, load_packs, load_taglish

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def positive_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be finite and greater than zero")
    return number


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        epilog="Examples:\n  python backend/evals/run_eval.py --server http://127.0.0.1:8080\n  python backend/evals/run_eval.py --llama-server C:/llama/llama-server.exe --models C:/models/a.gguf C:/models/b.gguf")
    workflow = cli.add_mutually_exclusive_group(required=True)
    workflow.add_argument("--server", help="existing llama-server URL, optionally ending in /v1")
    workflow.add_argument("--llama-server", help="executable path or command on PATH; launch and stop each model")
    cli.add_argument("--models", nargs="+", type=Path, help="GGUF paths for sequential mode")
    cli.add_argument("--model-name", help="existing-server model ID; otherwise discovered through /v1/models")
    cli.add_argument("--questions", type=Path, default=HERE / "questions.json", help="benchmark JSON array")
    cli.add_argument("--packs-dir", type=Path, default=ROOT / "frontend/public/packs", help="generated knowledge JSON directory")
    cli.add_argument("--pack-ids", nargs="+", help="pack IDs to include, in this order; default: all JSON packs alphabetically")
    cli.add_argument("--top-k", type=positive_int, default=3, help="number of retrieved passages (not the sampling top-k)")
    cli.add_argument("--no-rag", action="store_true", help="send only the question plus the same system prompt; skip pack loading")
    cli.add_argument("--prompt", type=Path, help="override system prompt with a UTF-8 text file; default: read ask.ts SYSTEM")
    cli.add_argument("--temperature", type=float, default=0.0, help="sampling temperature; frontend currently uses 0.3")
    cli.add_argument("--seed", type=int, default=42, help="sampling seed (hardware/version determinism is not guaranteed)")
    cli.add_argument("--max-tokens", type=positive_int, default=400, help="maximum generated tokens, matching the frontend default")
    cli.add_argument("--timeout", type=positive_float, default=120.0, help="HTTP socket timeout in seconds per request")
    cli.add_argument("--startup-timeout", type=positive_float, default=180.0, help="deadline in seconds waiting for /health")
    cli.add_argument("--output-dir", type=Path, default=HERE / "results", help="JSON checkpoints, Markdown comparisons, and owned-server logs")
    cli.add_argument("--port", type=int, default=0, help="owned-server port; 0 chooses a free localhost port")
    cli.add_argument("--ctx-size", type=positive_int, default=4096, help="owned-server context size")
    cli.add_argument("--threads", type=positive_int, help="owned-server CPU threads; omit for server default")
    cli.add_argument("--gpu-layers", type=int, default=0, help="owned-server GPU layers; 0 is CPU-only, -1 offloads all")
    cli.add_argument("--server-arg", action="append", default=[], help="extra single server argument, repeat as --server-arg=--flag --server-arg=value")
    cli.add_argument("--chat-template-kwargs", help='JSON template options; default: {"enable_thinking": false} for Qwen3.5 names, otherwise omitted')
    cli.add_argument("--api-key-env", default="LLAMA_API_KEY", help="environment variable containing an existing-server bearer token; never saved")
    cli.add_argument("--fail-on-checks", action="store_true", help="exit 1 when any deterministic answer/retrieval check fails")
    return cli


def normalize_server(value: str) -> str:
    parsed = parse.urlsplit(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise EvalError(f"Invalid server URL: {exc}") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise EvalError("--server must be an http(s) URL without credentials, query, or fragment")
    if port is not None and not 1 <= port <= 65535:
        raise EvalError("Invalid server port")
    base = value.rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


class Client:
    def __init__(self, base: str, timeout: float, api_key: str = ""):
        self.base, self.timeout, self.api_key = normalize_server(base), timeout, api_key

    def json(self, endpoint: str, payload: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = request.Request(self.base + endpoint, data=body, headers=headers)
        try:
            with request.urlopen(req, timeout=timeout or self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            # Preserve diagnostic text, not an enormous server error page.
            detail = exc.read(4096).decode("utf-8", errors="replace")
            raise EvalError(f"HTTP {exc.code} at {endpoint}: {detail}") from exc
        except (error.URLError, TimeoutError, OSError, http.client.HTTPException, UnicodeError, json.JSONDecodeError) as exc:
            raise EvalError(f"Request {endpoint} failed: {exc}") from exc
        if not isinstance(data, dict) or data.get("error"):
            raise EvalError(f"Malformed/error API response at {endpoint}: {str(data)[:1000]}")
        return data


def wait_ready(client: Client, deadline_seconds: float, process: subprocess.Popen | None = None) -> None:
    deadline = time.monotonic() + deadline_seconds
    last_error = "server not ready"
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise EvalError(f"llama-server exited with code {process.returncode}; inspect its log")
        try:
            health = client.json("/health", timeout=min(2.0, max(0.01, deadline - time.monotonic())))
            if health.get("status") == "ok":
                return
            last_error = f"Unexpected health response: {health}"
        except EvalError as exc:
            last_error = str(exc)
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))
    raise EvalError(f"Startup timeout after {deadline_seconds:g}s: {last_error}")


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
        return
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        process.terminate()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


@contextmanager
def managed_server(args: argparse.Namespace, model: Path, alias: str, log_path: Path) -> Iterator[Client]:
    # Refuse an occupied port rather than accidentally evaluating another process.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", args.port))
        port = reservation.getsockname()[1]
    command = [args.llama_server, "--model", str(model.resolve()), "--host", "127.0.0.1", "--port", str(port), "--alias", alias,
               "--ctx-size", str(args.ctx_size), "--batch-size", "512", "--parallel", "1", "--gpu-layers", str(args.gpu_layers), "--jinja"]
    if args.threads:
        command += ["--threads", str(args.threads)]
    command += args.server_arg
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                   creationflags=flags, start_new_session=os.name != "nt")
        try:
            client = Client(f"http://127.0.0.1:{port}", args.timeout)
            wait_ready(client, args.startup_timeout, process)
            yield client
        finally:
            stop_process(process)


def numeric(value: Any, integer: bool = False) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    if integer and value != int(value):
        return None
    return int(value) if integer else float(value)


def parse_completion(data: dict[str, Any]) -> dict[str, Any]:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise EvalError("Malformed chat response: missing choices[0]")
    message = choices[0].get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str) or not message["content"].strip():
        raise EvalError("Malformed chat response: expected nonempty message.content text (reasoning-only/tool responses are not answers)")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    timings = data.get("timings") if isinstance(data.get("timings"), dict) else {}
    count = numeric(usage.get("completion_tokens"), integer=True)
    if count is None:
        count = numeric(timings.get("predicted_n"), integer=True)
    speed = numeric(timings.get("predicted_per_second"))
    ms, timing_count = numeric(timings.get("predicted_ms")), numeric(timings.get("predicted_n"))
    if speed is None and ms and timing_count is not None:
        speed = timing_count / (ms / 1000)
    return {"answer": message["content"], "reasoning_content": message.get("reasoning_content"),
            "finish_reason": choices[0].get("finish_reason"), "generation_tokens": count,
            "tokens_per_second": speed, "usage": usage, "timings": timings}


def base_result(question: dict[str, Any], model: str, references: list[dict[str, Any]], rag: bool) -> dict[str, Any]:
    expected = question.get("expected_source_ids", [])
    retrieved = {f"{p['packId']}/{p['articleId']}" for p in references}
    retrieval_failed = [f"Expected retrieved article: {source}" for source in expected if source not in retrieved] if rag else []
    return {"model": model, "question_id": question["id"], "category": question["category"], "language": question["language"],
            "question": question["question"], "expected_behavior": question["expected_behavior"], "notes": question.get("notes", ""),
            "must_include": question["must_include"], "must_not_include": question["must_not_include"],
            "references": references, "retrieval_passed": not retrieval_failed if rag and expected else None,
            "retrieval_failed_checks": retrieval_failed, "answer": "", "passed": False, "failed_checks": [],
            "total_latency_s": None, "response_latency_s": None, "generation_tokens": None, "tokens_per_second": None, "error": None}


def evaluate_question(client: Client, question: dict[str, Any], model: str, request_model: str, system: str,
                      retriever: Retriever | None, args: argparse.Namespace, kwargs: dict[str, Any] | None) -> dict[str, Any]:
    start = time.perf_counter()
    references = retriever.search(question["question"], args.top_k) if retriever else []
    row = base_result(question, model, references, not args.no_rag)
    row["messages"] = build_messages(system, question["question"], references, not args.no_rag)
    payload = {"model": request_model, "messages": row["messages"], "temperature": args.temperature,
               "max_tokens": args.max_tokens, "seed": args.seed, "stream": False}
    if kwargs is not None:
        payload["chat_template_kwargs"] = kwargs
    request_start = time.perf_counter()
    try:
        row.update(parse_completion(client.json("/v1/chat/completions", payload)))
        row["failed_checks"] = check_answer(question, row["answer"], row.get("finish_reason"))
        row["passed"] = not row["failed_checks"]
    except EvalError as exc:
        row["error"] = str(exc)
    row["response_latency_s"] = round(time.perf_counter() - request_start, 6)
    row["total_latency_s"] = round(time.perf_counter() - start, 6)
    return row


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def summaries(report: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"model": model["model"], "passed": sum(row["passed"] for row in model["results"]), "total": len(model["results"]),
             "errors": sum(row["error"] is not None for row in model["results"]),
             "avg_latency_s": mean([row["total_latency_s"] for row in model["results"] if row["total_latency_s"] is not None]),
             "avg_tokens_per_second": mean([row["tokens_per_second"] for row in model["results"] if row["tokens_per_second"] is not None]),
             "retrieval_passed": sum(row["retrieval_passed"] is True for row in model["results"]),
             "retrieval_total": sum(row["retrieval_passed"] is not None for row in model["results"])} for model in report["models"]]


def display(value: float | None, suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:.2f}{suffix}"


def cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def fenced(text: str) -> str:
    longest = max((len(group) for group in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}text\n{text}\n{fence}"


def markdown(report: dict[str, Any]) -> str:
    lines = ["# CollapseAI evaluation", "", f"Created: {report['created_at']} · RAG: {report['config']['rag']} · Retriever: {report['config']['retriever']}",
             "", "Pass counts are deterministic text checks, not a safety/clinical judgement. Retrieval checks are reported separately.",
             "", "| Model | Answer checks | Errors | Avg latency | Avg generation tok/s | Retrieval checks |", "|---|---:|---:|---:|---:|---:|"]
    for item in summaries(report):
        lines.append(f"| {cell(item['model'])} | {item['passed']}/{item['total']} | {item['errors']} | {display(item['avg_latency_s'], 's')} | {display(item['avg_tokens_per_second'])} | {item['retrieval_passed']}/{item['retrieval_total']} |")
    if report["interrupted"]:
        lines += ["", "**Interrupted: this report contains completed/attempted questions only.**"]
    for model in report["models"]:
        lines += ["", f"## {model['model']}", "", f"Model path / server model ID: {model.get('model_path') or model.get('request_model', 'unavailable')}"]
        if model.get("error"):
            lines += ["", fenced(model["error"])]
        lines += ["", "| Question | Language | Answer checks | Retrieval | Latency | Tokens | Tok/s | References |", "|---|---|---|---|---:|---:|---:|---|"]
        for row in model["results"]:
            references = "; ".join(f"{p['id']} — {p['title']}" for p in row["references"])
            retrieval = "n/a" if row["retrieval_passed"] is None else "pass" if row["retrieval_passed"] else "fail"
            status = "error" if row["error"] else "pass" if row["passed"] else "fail"
            lines.append(f"| {cell(row['question_id'])} | {cell(row['language'])} | {status} | {retrieval} | {display(row['total_latency_s'], 's')} | {row['generation_tokens'] if row['generation_tokens'] is not None else 'n/a'} | {display(row['tokens_per_second'])} | {cell(references)} |")
        for row in model["results"]:
            lines += ["", f"### {row['question_id']} ({row['category']}, {row['language']})", "", f"Question: {row['question']}", "", f"Expected: {row['expected_behavior']}", "", fenced(row["answer"] or "[No answer returned]")]
            for failure in row["failed_checks"] + row["retrieval_failed_checks"]:
                lines.append(f"- {cell(failure)}")
            if row["error"]:
                lines += ["", "Error:", fenced(row["error"])]
            if row["notes"]:
                lines += ["", f"Review notes: {row['notes']}"]
            for passage in row["references"]:
                lines += ["", f"Reference: {passage['id']} — {passage['title']} ({passage['category']})", fenced(passage["text"])]
    return "\n".join(lines) + "\n"


def save_report(report: dict[str, Any], destination: Path, final: bool = False) -> None:
    report["summary"] = summaries(report)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(destination.with_suffix(".json"))
    if final:
        destination.with_suffix(".md").write_text(markdown(report), encoding="utf-8")


def validate_options(args: argparse.Namespace) -> dict[str, Any] | None:
    if not math.isfinite(args.temperature) or args.temperature < 0:
        raise EvalError("--temperature must be finite and nonnegative")
    if not 0 <= args.port <= 65535 or args.gpu_layers < -1:
        raise EvalError("--port must be 0..65535 and --gpu-layers must be -1 or greater")
    if args.server and args.models:
        raise EvalError("--models is only valid with --llama-server")
    if args.llama_server:
        if not args.models:
            raise EvalError("--llama-server requires --models")
        executable = shutil.which(args.llama_server)
        if not executable:
            raise EvalError(f"llama-server executable unavailable: {args.llama_server}")
        args.llama_server = executable
        for model in args.models:
            if not model.is_file() or model.suffix.lower() != ".gguf":
                raise EvalError(f"GGUF model file unavailable: {model}")
        if any(arg.split("=")[0] in {"--host", "--port", "--model", "-m", "--alias"} for arg in args.server_arg):
            raise EvalError("--server-arg cannot override owned-server host, port, model, or alias")
    if args.pack_ids and any(not re.fullmatch(r"[A-Za-z0-9_-]+", pack) for pack in args.pack_ids):
        raise EvalError("--pack-ids must be simple IDs, not paths")
    if args.chat_template_kwargs is not None:
        try:
            kwargs = json.loads(args.chat_template_kwargs)
        except json.JSONDecodeError as exc:
            raise EvalError(f"Invalid --chat-template-kwargs JSON: {exc}") from exc
        if not isinstance(kwargs, dict):
            raise EvalError("--chat-template-kwargs must be a JSON object")
        try:
            json.dumps(kwargs, allow_nan=False)
        except ValueError as exc:
            raise EvalError("--chat-template-kwargs cannot contain NaN or infinity") from exc
        return kwargs
    return None


def run(args: argparse.Namespace) -> int:
    kwargs_override = validate_options(args)
    questions = load_questions(args.questions)
    prompt_path = args.prompt or ROOT / "frontend/src/lib/ask.ts"
    system = args.prompt.read_text(encoding="utf-8-sig").strip() if args.prompt else production_prompt(prompt_path)
    if not system:
        raise EvalError("System prompt is empty")
    retriever = None
    pack_files: list[Path] = []
    if not args.no_rag:
        passages, pack_files = load_packs(args.packs_dir, args.pack_ids)
        retriever = Retriever(passages, load_taglish(ROOT / "frontend/src/lib/knowledge.ts"))
    if args.server:
        normalize_server(args.server)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc)
    destination = args.output_dir / (timestamp.strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid.uuid4().hex[:8])
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    report: dict[str, Any] = {"schema_version": 1, "created_at": timestamp.isoformat(), "interrupted": False,
        "config": {"rag": not args.no_rag, "retriever": RETRIEVER if retriever else "none", "top_k": args.top_k,
                   "questions_path": str(args.questions.resolve()), "questions_sha256": digest(args.questions),
                   "system_prompt": system, "prompt_path": str(prompt_path.resolve()), "prompt_sha256": digest(prompt_path),
                   "knowledge_source_sha256": digest(ROOT / "frontend/src/lib/knowledge.ts") if retriever else None,
                   "packs": [{"path": str(path.resolve()), "sha256": digest(path)} for path in pack_files],
                   "temperature": args.temperature, "seed": args.seed, "max_tokens": args.max_tokens,
                   "timeout_s": args.timeout, "startup_timeout_s": args.startup_timeout,
                   "ctx_size": args.ctx_size if args.llama_server else None, "gpu_layers": args.gpu_layers if args.llama_server else None,
                   "threads": args.threads, "server_args": args.server_arg}, "models": []}
    targets = args.models if args.llama_server else [None]
    try:
        for index, model_path in enumerate(targets):
            label = model_path.name if model_path else args.model_name or "existing-server"
            model_report: dict[str, Any] = {"model": label, "model_path": str(model_path.resolve()) if model_path else None,
                                          "results": [], "error": None}
            report["models"].append(model_report)

            def evaluate(client: Client, request_model: str) -> None:
                model_report["server"] = client.base
                model_report["request_model"] = request_model
                identity = str(model_path) if model_path else request_model
                kwargs = kwargs_override if kwargs_override is not None else {"enable_thinking": False} if "qwen3.5" in identity.lower() or "qwen35" in identity.lower() else None
                model_report["chat_template_kwargs"] = kwargs
                for question in questions:
                    row = evaluate_question(client, question, label, request_model, system, retriever, args, kwargs)
                    model_report["results"].append(row)
                    save_report(report, destination)
                    print(f"{label}: {question['id']} {'ERROR' if row['error'] else 'PASS' if row['passed'] else 'FAIL'} ({display(row['total_latency_s'], 's')})", flush=True)

            try:
                if model_path:
                    alias = f"collapseai-eval-{uuid.uuid4().hex[:12]}"
                    log_path = destination.with_name(destination.name + f"-model{index + 1}.log")
                    model_report["server_log"] = str(log_path.resolve())
                    with managed_server(args, model_path, alias, log_path) as client:
                        evaluate(client, alias)
                else:
                    client = Client(args.server, args.timeout, os.environ.get(args.api_key_env, ""))
                    wait_ready(client, args.startup_timeout)
                    request_model = args.model_name
                    if not request_model:
                        data = client.json("/v1/models").get("data")
                        if not isinstance(data, list) or not data or not isinstance(data[0], dict) or not isinstance(data[0].get("id"), str) or not data[0]["id"].strip():
                            raise EvalError("Cannot discover a model ID; provide --model-name")
                        if len(data) != 1:
                            raise EvalError("Server lists multiple models; choose one with --model-name")
                        request_model = data[0]["id"]
                    evaluate(client, request_model)
            except (EvalError, OSError) as exc:
                model_report["error"] = str(exc)
                completed = {row["question_id"] for row in model_report["results"]}
                for question in questions:
                    if question["id"] not in completed:
                        refs = retriever.search(question["question"], args.top_k) if retriever else []
                        row = base_result(question, label, refs, not args.no_rag)
                        row["error"] = str(exc)
                        model_report["results"].append(row)
                save_report(report, destination)
                print(f"{label}: {exc}", file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        report["interrupted"] = True
        print("Interrupted; saving partial results after stopping the owned server.", file=sys.stderr)
    finally:
        save_report(report, destination, final=True)
    print("\nMODEL                             PASS      ERRORS    AVG LATENCY   AVG GEN TOK/S")
    for item in summaries(report):
        print(f"{item['model']:<32} {item['passed']:>3}/{item['total']:<5} {item['errors']:>5}     {display(item['avg_latency_s'], 's'):>10}   {display(item['avg_tokens_per_second']):>12}")
    print(f"\nJSON: {destination.with_suffix('.json').resolve()}\nMarkdown: {destination.with_suffix('.md').resolve()}")
    if report["interrupted"]:
        return 130
    rows = [row for model in report["models"] for row in model["results"]]
    return int(any(row["error"] for row in rows) or (args.fail_on_checks and any(not row["passed"] or row["retrieval_passed"] is False for row in rows)))


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return run(args)
    except KeyboardInterrupt:
        print("Interrupted before evaluation started.", file=sys.stderr)
        return 130
    except (EvalError, OSError, UnicodeError) as exc:
        print(f"Evaluation error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
