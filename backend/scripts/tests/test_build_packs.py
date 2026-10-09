"""Pack Builder v2 validation and exact-byte manifest tests (standard library)."""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import build_packs as builder


def valid_pack():
    return {"id": "valid", "name": "Valid pack", "version": 1, "license": "Team content",
            "articles": [{"id": "safe-water", "title": "Safe water", "category": "Water", "source": "Team reference", "text": "Useful guidance.\n\nAnother short paragraph."}]}


def markdown(pack_id="valid", title="Safe water", body="Useful guidance."):
    return f"---\nid: {pack_id}\nname: Valid pack\nlicense: Team content\n---\n\n# {title}\ncategory: Water\nsource: Team reference\n\n{body}\n"


class ValidationTests(unittest.TestCase):
    def test_valid_pack(self):
        builder.validate_pack(valid_pack(), "fixture")

    def test_preserves_current_node_metadata_with_explicit_dates(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "valid.md"
            text = markdown().replace("license: Team content", "license: Team content\nlast_verified: 2026-10-09\nkeywords: water, tubig")
            text = text.replace("source: Team reference", "source: Team reference\ntags: water, tubig\ndisaster_types: flood")
            path.write_text(text, encoding="utf-8")
            pack = builder.parse(path)
            self.assertEqual(pack["updated"], "2026-10-09")
            self.assertEqual(pack["keywords"], ["water", "tubig"])
            self.assertEqual(pack["articles"][0]["tags"], ["water", "tubig"])
            self.assertEqual(pack["articles"][0]["disaster_types"], ["flood"])
            self.assertEqual(pack["articles"][0]["last_verified"], "2026-10-09")
            self.assertEqual(pack["articles"][0]["text"], "Useful guidance.")

    def test_articles_must_be_an_array_and_nonempty(self):
        for value in [None, {}, "articles", []]:
            pack = valid_pack()
            pack["articles"] = value
            with self.assertRaisesRegex(builder.BuildError, "articles"):
                builder.validate_pack(pack, "fixture")

    def test_duplicate_article_ids(self):
        pack = valid_pack()
        pack["articles"].append(copy.deepcopy(pack["articles"][0]))
        with self.assertRaisesRegex(builder.BuildError, "duplicate article ID/slug"):
            builder.validate_pack(pack, "fixture")

    def test_missing_and_empty_required_fields(self):
        for field in ["id", "title", "category", "text"]:
            for value in [None, "", "   ", 4]:
                pack = valid_pack()
                if value is None:
                    del pack["articles"][0][field]
                else:
                    pack["articles"][0][field] = value
                with self.assertRaisesRegex(builder.BuildError, field):
                    builder.validate_pack(pack, "fixture")
        for field in ["id", "name", "version"]:
            pack = valid_pack()
            del pack[field]
            with self.assertRaises(builder.BuildError):
                builder.validate_pack(pack, "fixture")

    def test_invalid_slugs_and_versions(self):
        for identifier in ["../escape", "Title With Spaces", "a/b", ""]:
            pack = valid_pack()
            pack["id"] = identifier
            with self.assertRaises(builder.BuildError):
                builder.validate_pack(pack, "fixture")
        for value in [True, 0, -1, "1"]:
            pack = valid_pack()
            pack["version"] = value
            with self.assertRaisesRegex(builder.BuildError, "version"):
                builder.validate_pack(pack, "fixture")

    def test_oversized_passage_and_article_content(self):
        pack = valid_pack()
        pack["articles"][0]["text"] = "x" * 1001
        with self.assertRaisesRegex(builder.BuildError, "passage #0.*1001"):
            builder.validate_pack(pack, "fixture")
        builder.validate_pack(pack, "fixture", max_passage_chars=1001)
        with self.assertRaisesRegex(builder.BuildError, "max-article-chars"):
            builder.validate_pack(pack, "fixture", max_passage_chars=1001, max_article_chars=1000)

    def test_production_chunk_boundary_and_utf16_limit(self):
        self.assertEqual(builder.passage_texts("a" * 400 + "\n\n" + "b" * 300), ["a" * 400, "b" * 300])
        self.assertEqual(builder.passage_texts("a" * 300 + "\n\n" + "b" * 300), ["a" * 300 + "\n\n" + "b" * 300])
        pack = valid_pack()
        pack["articles"][0]["text"] = "😀" * 501
        with self.assertRaisesRegex(builder.BuildError, "1002 UTF-16"):
            builder.validate_pack(pack, "fixture")


class SourceTests(unittest.TestCase):
    def test_markdown_and_json_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "valid.md"
            path.write_text(markdown(), encoding="utf-8")
            pack = builder.parse(path)
            self.assertEqual(pack["articles"][0]["id"], "safe-water")
            self.assertEqual(pack["version"], 1)
            path = path.with_suffix(".json")
            path.write_text(json.dumps(pack), encoding="utf-8")
            self.assertEqual(builder.parse(path), pack)

    def test_markdown_slug_collision_has_source_and_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.md"
            path.write_text(markdown(title="Safe water!") + "\n# Safe water?\ncategory: Water\n\nMore text.", encoding="utf-8")
            with self.assertRaisesRegex(builder.BuildError, r"duplicate.md:\d+: duplicate article ID/slug"):
                builder.parse(path)

    def test_malformed_source_headers_missing_category_and_empty_article(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.md"
            for text in ["not a header", "---\nid: bad", markdown().replace("name: Valid pack", "malformed"), markdown().replace("category: Water\n", ""), markdown(body=""), markdown(title=""), markdown().replace("id: valid", "id: valid\nid: other")]:
                path.write_text(text, encoding="utf-8")
                with self.assertRaisesRegex(builder.BuildError, "bad.md"):
                    builder.parse(path)

    def test_malformed_json_duplicate_keys_and_nonfinite_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            for content in ["{bad", '{"id":"a","id":"b"}', '{"version":NaN}', "[]"]:
                path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(builder.BuildError, "bad.json"):
                    builder.parse(path)


class BuildTests(unittest.TestCase):
    def fixture(self, root):
        sources, outputs = root / "sources", root / "public/packs"
        sources.mkdir()
        (sources / "valid.md").write_text(markdown(body="Unicode text: tubig, café, 😀."), encoding="utf-8")
        return sources, outputs

    def test_sha256_correctness_and_manifest_size_correctness(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            sources, outputs = self.fixture(root)
            manifest = builder.build(sources, outputs)
            on_disk = json.loads((root / "public/manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest, on_disk)
            entry = manifest["packs"][0]
            raw = (outputs / "valid.json").read_bytes()
            self.assertEqual(entry["size"], len(raw))
            self.assertEqual(entry["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(entry["articles"], 1)
            self.assertEqual(entry["path"], "/packs/valid.json")
            self.assertNotIn(b"\r\n", raw)
            self.assertGreater(len(raw), len(raw.decode("utf-8")))

    def test_duplicate_pack_ids_and_multiple_errors_do_not_modify_outputs(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            sources, outputs = self.fixture(Path(directory))
            builder.build(sources, outputs)
            previous = (outputs / "valid.json").read_bytes()
            previous_manifest = (outputs.parent / "manifest.json").read_bytes()
            (sources / "duplicate.md").write_text(markdown(), encoding="utf-8")
            (sources / "bad.json").write_text("{bad", encoding="utf-8")
            with self.assertRaises(builder.BuildError) as error:
                builder.build(sources, outputs)
            self.assertIn("duplicate pack ID", str(error.exception))
            self.assertIn("bad.json", str(error.exception))
            self.assertEqual((outputs / "valid.json").read_bytes(), previous)
            self.assertEqual((outputs.parent / "manifest.json").read_bytes(), previous_manifest)

    def test_build_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            sources, outputs = self.fixture(Path(directory))
            builder.build(sources, outputs)
            first = (outputs / "valid.json").read_bytes(), (outputs.parent / "manifest.json").read_bytes()
            builder.build(sources, outputs)
            self.assertEqual(first, ((outputs / "valid.json").read_bytes(), (outputs.parent / "manifest.json").read_bytes()))

    def test_invalid_generated_json_fails_before_publication(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(builder, "serialize", return_value=b'{"id":"valid"}'):
            sources, outputs = self.fixture(Path(directory))
            with self.assertRaises(builder.BuildError):
                builder.build(sources, outputs)
            self.assertFalse(outputs.exists())
            self.assertFalse((outputs.parent / "manifest.json").exists())

    def test_corrupt_output_prevents_manifest_publication(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            sources, outputs = self.fixture(Path(directory))
            builder.build(sources, outputs)
            manifest_path = outputs.parent / "manifest.json"
            previous = manifest_path.read_bytes()

            def corrupt_write(path, data):
                path.write_bytes(data + b"corruption")

            with patch.object(builder, "atomic_write", side_effect=corrupt_write), self.assertRaisesRegex(builder.BuildError, "size/hash mismatch"):
                builder.build(sources, outputs)
            self.assertEqual(manifest_path.read_bytes(), previous)

    def test_model_sizes_and_hashes_are_explicitly_unknown(self):
        models = builder.catalog_models(builder.CATALOG)
        self.assertEqual(len(models), 5)
        self.assertTrue(all(model["size"] is None and model["sha256"] is None for model in models))
        self.assertTrue(all(model["url"].startswith("https://huggingface.co/") for model in models))
        self.assertEqual(models[1]["id"], "qwen35-0.8b")

    def test_malformed_or_duplicate_model_catalog_fails_loudly(self):
        text = builder.CATALOG.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.ts"
            for content in ["not a catalog", text.replace("id: 'qwen35-0.8b'", "id: 'smollm2-360m'"), text.replace("${HF}/HuggingFaceTB/SmolLM2-360M", "${UNSUPPORTED}/HuggingFaceTB/SmolLM2-360M"), text.replace("https://huggingface.co", "https://[invalid")]:
                path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(builder.BuildError, "catalog.ts"):
                    builder.catalog_models(path)

    def test_output_io_failure_has_context_and_no_new_manifest(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            sources, outputs = self.fixture(Path(directory))
            (outputs / "valid.json").mkdir(parents=True)
            with self.assertRaisesRegex(builder.BuildError, "cannot write output"):
                builder.build(sources, outputs)
            self.assertFalse((outputs.parent / "manifest.json").exists())

    def test_cli_limit_failure_has_nonzero_exit_and_source_context(self):
        with tempfile.TemporaryDirectory() as directory:
            sources, outputs = self.fixture(Path(directory))
            result = subprocess.run([sys.executable, str(SCRIPTS / "build_packs.py"), "--source-dir", str(sources), "--output-dir", str(outputs), "--max-passage-chars", "3"], text=True, encoding="utf-8", capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("valid.md", result.stderr)
            self.assertIn("max-passage-chars", result.stderr)
            self.assertFalse(outputs.exists())


if __name__ == "__main__":
    unittest.main()
