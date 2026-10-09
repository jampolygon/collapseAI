"""Extract real regional maps from a LOCAL Protomaps PMTiles archive.

Requires the external go-pmtiles CLI for extraction/verification. No automatic
source download, no shell execution, and no network URL inputs.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Works both as a standalone script from any cwd and via unittest imports.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from backend.hub.maps import REGIONS, inspect_archive, sha256_file

# Broad extraction rectangles, NOT authoritative administrative boundaries.
# Overlap is intentional. Review coverage and adjust with --bounds if needed.
EXTRACT_BOUNDS = {
    "luzon": (116.0, 12.0, 124.5, 21.5),
    "visayas": (121.0, 9.0, 126.5, 13.0),
    "mindanao": (121.0, 4.5, 127.0, 10.5),
}


def run_cli(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except OSError as exc:
        raise ValueError(f"Could not run pmtiles CLI: {exc}") from exc
    if result.returncode:
        raise ValueError(f"pmtiles {command[1]} failed (exit {result.returncode}): {result.stderr.strip() or result.stdout.strip()}")


def catalog_entry(path, region_id):
    metadata = inspect_archive(path)
    checksum = sha256_file(path)
    return {"id": region_id, "name": dict(REGIONS)[region_id], "province": dict(REGIONS)[region_id],
            "pmtilesUrl": f"./maps/{region_id}.pmtiles", "sizeBytes": metadata["size"], "sha256": checksum,
            "bounds": metadata["bounds"], "center": metadata["center"], "revision": checksum[:16],
            "updatedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), "tileSchema": "protomaps-basemaps"}


def build(args):
    cli = shutil.which(args.pmtiles)
    if not cli:
        raise ValueError("Required pmtiles CLI was not found. Install go-pmtiles for your OS or supply --pmtiles C:\\tools\\pmtiles.exe")
    selected = args.region or list(EXTRACT_BOUNDS)
    if len(set(selected)) != len(selected):
        raise ValueError("Duplicate --region selections")
    if args.bounds and len(selected) != 1:
        raise ValueError("--bounds requires exactly one --region")
    if not 0 <= args.maxzoom <= 26 or args.max_bytes <= 0:
        raise ValueError("--maxzoom must be 0..26 and --max-bytes must be positive")
    if not args.publish_only and (not args.source or not args.source.is_file()):
        raise ValueError("A local --source PMTiles archive is required and must exist (URLs are not supported)")
    catalog = args.catalog or args.output_dir / "regions.json"
    targets = {(args.output_dir / f"{region_id}.pmtiles").resolve() for region_id in selected}
    if catalog.resolve() in targets or (args.source and catalog.resolve() == args.source.resolve()):
        raise ValueError("Catalog path must not overwrite a map archive or source")
    if not args.publish_only and args.source.resolve() in targets:
        raise ValueError("Output map paths must not overwrite the source archive")
    if not args.publish_only:
        inspect_archive(args.source)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".maps-build-", dir=args.output_dir) as temp:
        entries, staged = [], []
        for region_id in selected:
            if args.publish_only:
                path = args.output_dir / f"{region_id}.pmtiles"
                if not path.is_file():
                    raise ValueError(f"Required map file is absent: {path}")
            else:
                bounds = args.bounds or EXTRACT_BOUNDS[region_id]
                west, south, east, north = bounds
                if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                    raise ValueError("--bounds must be west,south,east,north within geographic limits")
                path = Path(temp) / f"{region_id}.pmtiles"
                run_cli([cli, "extract", str(args.source.resolve()), str(path),
                         "--bbox=" + ",".join(map(str, bounds)), f"--maxzoom={args.maxzoom}"])
                if not path.is_file():
                    raise ValueError(f"pmtiles extract produced no output for {region_id}")
                staged.append((path, args.output_dir / path.name))
            run_cli([cli, "verify", str(path.resolve())])
            entry = catalog_entry(path, region_id)
            if entry["sizeBytes"] > args.max_bytes:
                raise ValueError(f"{path.name}: {entry['sizeBytes']} bytes exceeds --max-bytes {args.max_bytes}; reduce --maxzoom or coverage")
            entries.append(entry)
        for source, target in staged:
            source.replace(target)
        value = {"version": 1, "updatedAt": max(e["updatedAt"] for e in entries),
                 "attribution": "© OpenStreetMap contributors", "regions": entries}
        catalog.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", delete=False, dir=catalog.parent) as file:
            temporary = Path(file.name)
            json.dump(value, file, ensure_ascii=False, indent=2)
            file.write("\n")
        try:
            temporary.replace(catalog)
        finally:
            temporary.unlink(missing_ok=True)
        print(f"Published {len(entries)} validated region(s) and {catalog}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="existing local Protomaps PMTiles v3 basemap")
    parser.add_argument("--region", action="append", choices=list(EXTRACT_BOUNDS), help="repeat; defaults to all three")
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--maxzoom", type=int, default=12)
    parser.add_argument("--max-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "backend/data/maps")
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--pmtiles", default="pmtiles", help="CLI executable name or absolute path")
    parser.add_argument("--publish-only", action="store_true", help="verify and catalog existing extracts without extracting")
    args = parser.parse_args(argv)
    try:
        build(args)
        return 0
    except (ValueError, OSError) as exc:
        print(f"Map build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
