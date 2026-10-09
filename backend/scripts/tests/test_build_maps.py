"""No source downloads: CLI failures are mocked and files are synthetic fixtures."""
import argparse
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.hub.tests.fixtures import synthetic_archive
from backend.scripts import build_maps


class MapBuildTests(unittest.TestCase):
    def test_expected_regions_and_valid_extraction_bounds(self):
        self.assertEqual(list(build_maps.EXTRACT_BOUNDS), ["luzon", "visayas", "mindanao"])
        for west, south, east, north in build_maps.EXTRACT_BOUNDS.values():
            self.assertTrue(-180 <= west < east <= 180 and -90 <= south < north <= 90)

    def test_missing_cli_has_clear_error(self):
        output = io.StringIO()
        with patch("shutil.which", return_value=None), contextlib.redirect_stderr(output):
            self.assertEqual(build_maps.main(["--pmtiles", "absent-tool"]), 1)
        self.assertIn("Required pmtiles CLI was not found", output.getvalue())

    def test_missing_local_source_has_clear_error(self):
        output = io.StringIO()
        with patch("shutil.which", return_value="pmtiles"), contextlib.redirect_stderr(output):
            self.assertEqual(build_maps.main(["--source", "nonexistent-source.pmtiles"]), 1)
        self.assertIn("local --source", output.getvalue())

    def test_external_tool_failure_is_not_silent(self):
        with patch("subprocess.run", return_value=argparse.Namespace(returncode=7, stdout="", stderr="fixture extraction failure")):
            with self.assertRaisesRegex(ValueError, "exit 7.*fixture extraction failure"):
                build_maps.run_cli(["pmtiles", "extract"])

    def test_publish_only_requires_actual_files(self):
        with tempfile.TemporaryDirectory() as temp, patch("shutil.which", return_value="pmtiles"):
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                result = build_maps.main(["--publish-only", "--region", "luzon", "--output-dir", temp])
            self.assertEqual(result, 1)
            self.assertIn("Required map file is absent", output.getvalue())
            self.assertFalse((Path(temp) / "regions.json").exists())

    def test_catalog_uses_actual_size_hash_and_bounds(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as temp, patch("shutil.which", return_value="pmtiles"), patch.object(build_maps, "run_cli"):
            path = Path(temp) / "luzon.pmtiles"
            data = synthetic_archive()
            path.write_bytes(data)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(build_maps.main(["--publish-only", "--region", "luzon", "--output-dir", temp]), 0)
            item = json.loads((Path(temp) / "regions.json").read_text(encoding="utf-8"))["regions"][0]
            self.assertEqual(item["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(item["sizeBytes"], len(data))
            self.assertEqual(item["pmtilesUrl"], "./maps/luzon.pmtiles")

    def test_extract_arguments_preserve_paths_with_spaces_and_no_shell(self):
        with patch("subprocess.run", return_value=argparse.Namespace(returncode=0, stdout="", stderr="")) as run:
            command = [r"C:\map tools\pmtiles.exe", "extract", r"C:\map data\source.pmtiles", r"C:\map data\luzon.pmtiles", "--bbox=116,12,124,22"]
            build_maps.run_cli(command)
            self.assertEqual(run.call_args.args[0], command)
            self.assertNotIn("shell", run.call_args.kwargs)

    def test_catalog_cannot_overwrite_an_archive(self):
        with tempfile.TemporaryDirectory() as temp, patch("shutil.which", return_value="pmtiles"):
            path = Path(temp) / "luzon.pmtiles"
            data = synthetic_archive()
            path.write_bytes(data)
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                code = build_maps.main(["--publish-only", "--region", "luzon", "--output-dir", temp, "--catalog", str(path)])
            self.assertEqual(code, 1)
            self.assertIn("must not overwrite", output.getvalue())
            self.assertEqual(path.read_bytes(), data)
