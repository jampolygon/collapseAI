"""Protocol/validation tests only. Synthetic responses are NOT model benchmarks."""
from __future__ import annotations

import contextlib
import io
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

EVALS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVALS))
import benchmark
import retrieval
import run_eval


def question(identifier="fixture_1"):
    return {"id": identifier, "category": "test_fixture", "language": "en", "question": "Fixture request, not a survival benchmark.",
            "expected_behavior": "Return a synthetic string to test protocol parsing only.", "must_include": ["fixture"], "must_not_include": [], "notes": "MOCK, NOT REAL INFERENCE"}


@contextlib.contextmanager
def fixture_server(actions):
    payloads = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, data):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                self.wfile.write(json.dumps(data).encode())
            except ConnectionError:
                pass

        def do_GET(self):
            self.reply({"status": "ok"} if self.path == "/health" else {"data": [{"id": "MOCK-NOT-INFERENCE"}]})

        def do_POST(self):
            payloads.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            action = actions.pop(0)
            if action == "malformed":
                self.reply({"choices": []})
            elif action == "slow":
                time.sleep(0.1)
                self.reply({"choices": []})
            else:
                self.reply({"choices": [{"message": {"content": "Synthetic fixture answer; NOT MODEL INFERENCE."}, "finish_reason": "stop"}],
                            "usage": {"completion_tokens": 8}, "timings": {"predicted_n": 8, "predicted_ms": 400, "predicted_per_second": 20}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", payloads
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class InputTests(unittest.TestCase):
    def test_default_questions_and_actual_pack_ids(self):
        questions = benchmark.load_questions(EVALS / "questions.json")
        passages, _ = retrieval.load_packs(run_eval.ROOT / "frontend/public/packs")
        article_ids = {f"{p['packId']}/{p['articleId']}" for p in passages}
        self.assertEqual(len(questions), 15)
        self.assertGreaterEqual(sum(q["language"] == "taglish" for q in questions), 3)
        self.assertTrue(all(source in article_ids for q in questions for source in q.get("expected_source_ids", [])))

    def test_malformed_benchmark_cli_does_not_start_or_write_results(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            output = Path(directory) / "outputs"
            for text in ["{bad json", "{}", "[]", json.dumps([question(), question()]), json.dumps([{**question(), "must_include": [{"regex": "["}]}])]:
                path.write_text(text)
                with patch.object(run_eval.Client, "json") as http, contextlib.redirect_stderr(io.StringIO()) as stderr:
                    code = run_eval.main(["--server", "http://127.0.0.1:1", "--questions", str(path), "--output-dir", str(output)])
                self.assertEqual(code, 2, text)
                self.assertIn("Evaluation error", stderr.getvalue())
                http.assert_not_called()
                self.assertFalse(output.exists())

    def test_malformed_pack_fails_before_http(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            for content in ["bad", json.dumps({"id": "broken", "articles": [{}]}), json.dumps({"id": "broken", "articles": []})]:
                path.write_text(content)
                with patch.object(run_eval.Client, "json") as http, contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(run_eval.main(["--server", "http://127.0.0.1:1", "--packs-dir", directory]), 2)
                http.assert_not_called()

    def test_prompt_extraction_tracks_frontend_and_rejects_interpolation(self):
        system = benchmark.production_prompt(run_eval.ROOT / "frontend/src/lib/ask.ts")
        self.assertIn("Always answer in English", system)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ask.ts"
            path.write_text("const SYSTEM = `updated prompt`;", encoding="utf-8")
            self.assertEqual(benchmark.production_prompt(path), "updated prompt")
            path.write_text("const SYSTEM = `changed ${value}`;", encoding="utf-8")
            with self.assertRaises(benchmark.EvalError):
                benchmark.production_prompt(path)

    def test_rules_alternatives_regex_unicode_and_truncation(self):
        q = {**question(), "must_include": [{"any_of": ["help", "aid"]}, {"regex": r"\b36\s+liters\b"}], "must_not_include": ["danger"]}
        self.assertEqual(benchmark.check_answer(q, "AID\n36 liters", "stop"), [])
        self.assertGreater(len(benchmark.check_answer(q, "danger", "length")), 2)
        self.assertTrue(benchmark.rule_matches("36 liters", "３６  liters"))


class RetrievalTests(unittest.TestCase):
    def test_taglish_mapping_and_real_bleeding_search(self):
        mapping = retrieval.load_taglish(run_eval.ROOT / "frontend/src/lib/knowledge.ts")
        self.assertEqual(retrieval.expand_query("Paano ang sugat at dugo?", mapping), ["wound", "cut", "bleeding", "at", "blood", "bleeding"])
        passages, _ = retrieval.load_packs(run_eval.ROOT / "frontend/public/packs")
        retriever = retrieval.Retriever(passages, mapping)
        sources = retriever.search("May malalim na sugat at maraming dugo", 3)
        self.assertTrue(any(p["articleId"] == "severe-bleeding" for p in sources))
        self.assertEqual(retriever.search("", 3), [])
        self.assertEqual(retriever.search("Paano ano ang mga", 3), [])

    def test_chunk_boundaries_preserve_long_paragraphs_and_utf16_lengths(self):
        article = {"id": "a", "title": "A", "category": "test", "text": "a" * 400 + "\n\n" + "b" * 300}
        passages = retrieval.chunk_article({"id": "p"}, article)
        self.assertEqual([p["id"] for p in passages], ["p/a#0", "p/a#1"])
        article["text"] = "x" * 1000
        self.assertEqual(len(retrieval.chunk_article({"id": "p"}, article)), 1)
        self.assertEqual(retrieval.js_length("😀"), 2)

    def test_pack_subset_and_rag_messages(self):
        passages, paths = retrieval.load_packs(run_eval.ROOT / "frontend/public/packs", ["first-aid"])
        self.assertEqual(len(paths), 1)
        self.assertTrue(all(p["packId"] == "first-aid" for p in passages))
        messages = benchmark.build_messages("system", "question", passages[:1], True)
        self.assertIn("Reference information:\n##", messages[1]["content"])
        self.assertEqual(benchmark.build_messages("system", "question", [], False)[1]["content"], "question")
        self.assertIn("No reference found", benchmark.build_messages("system", "question", [], True)[1]["content"])


class ProtocolTests(unittest.TestCase):
    def test_metrics_absent_are_unknown_and_not_total_latency_rates(self):
        data = {"choices": [{"message": {"content": "fixture"}}], "usage": {"completion_tokens": 5}}
        result = run_eval.parse_completion(data)
        self.assertEqual(result["generation_tokens"], 5)
        self.assertIsNone(result["tokens_per_second"])
        data["timings"] = {"predicted_n": 10, "predicted_ms": 500}
        self.assertEqual(run_eval.parse_completion(data)["tokens_per_second"], 20)
        self.assertIsNone(run_eval.numeric(float("inf")))
        self.assertIsNone(run_eval.numeric(True))

    def test_malformed_responses(self):
        for data in [{}, {"choices": []}, {"choices": [None]}, {"choices": [{"message": {"content": None}}]}]:
            with self.assertRaises(benchmark.EvalError):
                run_eval.parse_completion(data)

    def test_one_bad_question_continues_and_writes_full_json_and_markdown(self):
        with fixture_server(["malformed", "ok"]) as (base, payloads), tempfile.TemporaryDirectory() as directory:
            questions = Path(directory) / "questions.json"
            questions.write_text(json.dumps([question("fixture_bad"), question("fixture_good")]))
            output = Path(directory) / "results"
            with contextlib.redirect_stdout(io.StringIO()):
                code = run_eval.main(["--server", base + "/v1", "--questions", str(questions), "--no-rag", "--output-dir", str(output)])
            report = json.loads(next(output.glob("*.json")).read_text())
            rows = report["models"][0]["results"]
            self.assertEqual(code, 1)
            self.assertIsNotNone(rows[0]["error"])
            self.assertTrue(rows[1]["passed"])
            self.assertEqual(rows[1]["tokens_per_second"], 20)
            self.assertEqual(report["models"][0]["request_model"], "MOCK-NOT-INFERENCE")
            self.assertTrue(all(payload["temperature"] == 0 and payload["seed"] == 42 and payload["stream"] is False for payload in payloads))
            self.assertEqual(rows[1]["references"], [])
            self.assertIsNone(rows[1]["retrieval_passed"])
            self.assertIn("NOT MODEL INFERENCE", next(output.glob("*.md")).read_text())
            self.assertIsNotNone(report["summary"][0]["avg_latency_s"])

    def test_http_timeout_records_error(self):
        with fixture_server(["slow"]) as (base, _):
            args = run_eval.parser().parse_args(["--server", base, "--no-rag", "--timeout", "0.02"])
            row = run_eval.evaluate_question(run_eval.Client(base, .02), question(), "MOCK", "MOCK", "system", None, args, None)
            self.assertIsNotNone(row["error"])
            self.assertFalse(row["passed"])

    def test_unavailable_server_creates_only_error_rows(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            base = f"http://127.0.0.1:{listener.getsockname()[1]}"
            with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = run_eval.main(["--server", base, "--no-rag", "--startup-timeout", "0.1", "--output-dir", directory])
                report = json.loads(next(Path(directory).glob("*.json")).read_text())
        self.assertEqual(code, 1)
        self.assertTrue(all(row["error"] and not row["answer"] and not row["passed"] for row in report["models"][0]["results"]))
        self.assertIsNone(report["summary"][0]["avg_latency_s"])

    def test_occupied_owned_port_refused_before_launch(self):
        args = run_eval.parser().parse_args(["--llama-server", sys.executable, "--models", "unused.gguf"])
        with socket.socket() as reservation, tempfile.TemporaryDirectory() as directory:
            reservation.bind(("127.0.0.1", 0))
            args.port = reservation.getsockname()[1]
            with patch.object(run_eval.subprocess, "Popen") as launch, self.assertRaises(OSError):
                with run_eval.managed_server(args, Path("unused.gguf"), "fixture", Path(directory) / "fixture.log"):
                    pass
            launch.assert_not_called()

    def test_owned_process_cleanup_on_failure_and_ctrl_c(self):
        args = run_eval.parser().parse_args(["--llama-server", sys.executable, "--models", "unused.gguf"])
        for failure in [benchmark.EvalError("fixture startup failure"), KeyboardInterrupt()]:
            process = MagicMock()
            with tempfile.TemporaryDirectory() as directory, patch.object(run_eval.subprocess, "Popen", return_value=process) as launch, patch.object(run_eval, "wait_ready", side_effect=failure), patch.object(run_eval, "stop_process") as stop:
                with self.assertRaises(type(failure)):
                    with run_eval.managed_server(args, Path("unused.gguf"), "fixture", Path(directory) / "fixture.log"):
                        pass
                stop.assert_called_once_with(process)
                self.assertIsInstance(launch.call_args.args[0], list)
                self.assertNotIn("shell", launch.call_args.kwargs)

    def test_forced_shutdown_waits_and_reaps(self):
        process = MagicMock()
        process.poll.return_value = None
        process.send_signal.side_effect = OSError("fixture")
        process.wait.side_effect = [subprocess.TimeoutExpired("fixture", 2), 0]
        with patch.object(run_eval.os, "killpg", side_effect=OSError("fixture"), create=True):
            run_eval.stop_process(process)
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertEqual(process.wait.call_count, 2)

    def test_owned_cleanup_when_evaluation_body_is_interrupted(self):
        args = run_eval.parser().parse_args(["--llama-server", sys.executable, "--models", "unused.gguf"])
        process = MagicMock()
        with tempfile.TemporaryDirectory() as directory, patch.object(run_eval.subprocess, "Popen", return_value=process), patch.object(run_eval, "wait_ready"), patch.object(run_eval, "stop_process") as stop:
            with self.assertRaises(KeyboardInterrupt):
                with run_eval.managed_server(args, Path("unused.gguf"), "fixture", Path(directory) / "fixture.log"):
                    raise KeyboardInterrupt()
            stop.assert_called_once_with(process)

    def test_sequential_model_startup_failure_does_not_skip_next_model(self):
        with fixture_server(["ok"]) as (base, payloads), tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "MOCK-first.gguf", Path(directory) / "MOCK-second.gguf"
            first.write_bytes(b"MOCK NOT A REAL GGUF")
            second.write_bytes(b"MOCK NOT A REAL GGUF")
            questions = Path(directory) / "questions.json"
            questions.write_text(json.dumps([question()]))
            stopped = []

            @contextlib.contextmanager
            def owned_fixture(args, model, alias, log):
                if model == first:
                    raise benchmark.EvalError("MOCK startup failure, not inference")
                try:
                    yield run_eval.Client(base, 1)
                finally:
                    stopped.append(model)

            output = Path(directory) / "results"
            with patch.object(run_eval, "managed_server", side_effect=owned_fixture), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = run_eval.main(["--llama-server", sys.executable, "--models", str(first), str(second), "--questions", str(questions), "--no-rag", "--output-dir", str(output)])
            report = json.loads(next(output.glob("*.json")).read_text())
            self.assertEqual(code, 1)
            self.assertEqual(len(report["models"]), 2)
            self.assertIn("MOCK startup failure", report["models"][0]["results"][0]["error"])
            self.assertIn("NOT MODEL INFERENCE", report["models"][1]["results"][0]["answer"])
            self.assertEqual(len(payloads), 1)
            self.assertEqual(stopped, [second])

    def test_interrupt_saves_partial_output(self):
        with fixture_server([]) as (base, _), tempfile.TemporaryDirectory() as directory:
            row = run_eval.base_result(question("fixture_1"), "MOCK", [], False)
            with patch.object(run_eval, "evaluate_question", side_effect=[row, KeyboardInterrupt()]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = run_eval.main(["--server", base, "--no-rag", "--output-dir", directory])
            report = json.loads(next(Path(directory).glob("*.json")).read_text())
            self.assertEqual(code, 130)
            self.assertTrue(report["interrupted"])
            self.assertEqual(len(report["models"][0]["results"]), 1)
            self.assertTrue(list(Path(directory).glob("*.md")))

    def test_markdown_handles_answer_backticks_and_unique_filenames(self):
        output = run_eval.fenced("```\nfixture\n```")
        self.assertTrue(output.startswith("````text"))
        self.assertEqual(run_eval.normalize_server("http://localhost:8080/v1/"), "http://localhost:8080")
        with self.assertRaises(benchmark.EvalError):
            run_eval.normalize_server("http://user:password@localhost:8080")


if __name__ == "__main__":
    unittest.main()
