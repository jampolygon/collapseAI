"""Small PMTiles v3 inspector shared by Hub discovery and offline build tooling.

Checks header, section bounds, root directory and basemap metadata. It does not
decode every tile; full CLI verification and device rendering remain necessary.
"""
import gzip
import hashlib
import io
import json
import struct
import threading
from pathlib import Path

REGIONS = (("luzon", "Luzon"), ("visayas", "Visayas"), ("mindanao", "Mindanao"))
REGIONAL_LIMIT = 128 * 1024 * 1024
COUNTRY_LIMIT = 256 * 1024 * 1024


def map_archive_limit(region_id):
    return COUNTRY_LIMIT if region_id == "philippines" else REGIONAL_LIMIT


MAX_SECTION = 16 * 1024 * 1024
BASEMAP_LAYERS = {"earth", "landcover", "landuse", "roads", "water", "buildings", "boundaries", "pois", "places"}


def unpack_section(data: bytes, compression: int) -> bytes:
    if compression == 1:
        return data
    if compression == 2:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as file:
            result = file.read(MAX_SECTION + 1)
        if len(result) > MAX_SECTION:
            raise ValueError("PMTiles metadata/directory exceeds 16 MiB")
        return result
    raise ValueError("PMTiles internal compression must be none or gzip")


def root_entries(data: bytes):
    cursor = 0

    def varint():
        nonlocal cursor
        value = 0
        for shift in range(0, 70, 7):
            if cursor >= len(data):
                raise ValueError("Truncated PMTiles root directory")
            byte = data[cursor]
            cursor += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError("Invalid PMTiles directory varint")

    count = varint()
    if not 0 < count <= len(data):
        raise ValueError("Empty or invalid PMTiles root directory")
    tile_ids = []
    current = 0
    for index in range(count):
        delta = varint()
        if index and not delta:
            raise ValueError("Unsorted PMTiles directory")
        current += delta
        tile_ids.append(current)
    runs = [varint() for _ in range(count)]
    lengths = [varint() for _ in range(count)]
    offsets = []
    for index in range(count):
        offset = varint()
        if offset == 0:
            if index == 0:
                raise ValueError("Invalid first PMTiles directory offset")
            offset = offsets[-1] + lengths[index - 1]
        else:
            offset -= 1
        offsets.append(offset)
    if cursor != len(data):
        raise ValueError("Unexpected PMTiles directory bytes")
    return list(zip(tile_ids, runs, lengths, offsets))


def inspect_archive(path: Path) -> dict:
    try:
        size = path.stat().st_size
        with path.open("rb") as file:
            header = file.read(127)
            if len(header) != 127 or header[:8] != b"PMTiles\x03":
                raise ValueError("Not a PMTiles v3 archive")
            if header[99] != 1:
                raise ValueError("PMTiles archive must contain MVT vector tiles")
            if header[98] not in (1, 2):
                raise ValueError("Vector tile compression must be none or gzip")
            values = struct.unpack_from("<11Q", header, 8)
            sections = list(zip(values[:8:2], values[1:8:2]))
            root, metadata, leaf, tiles = sections
            if not root[1] or not metadata[1] or not tiles[1] or not all(values[8:11]):
                raise ValueError("PMTiles archive has no directory, metadata or tile data")
            occupied = sorted((offset, offset + length) for offset, length in sections if length)
            if any(start < 127 or end > size for start, end in occupied) or any(a[1] > b[0] for a, b in zip(occupied, occupied[1:])):
                raise ValueError("PMTiles sections overlap or exceed the file size")

            def read_section(section):
                offset, length = section
                if length > MAX_SECTION:
                    raise ValueError("PMTiles metadata/directory exceeds 16 MiB")
                file.seek(offset)
                return unpack_section(file.read(length), header[97])

            entries = root_entries(read_section(root))
            for tile_id, run, length, offset in entries:
                limit = tiles[1] if run else leaf[1]
                if not length or offset + length > limit or tile_id > (4 ** 27 - 1) // 3:
                    raise ValueError("PMTiles root entry points outside its data section")
            info = json.loads(read_section(metadata))
            layers = info.get("vector_layers") if isinstance(info, dict) else None
            ids = {entry.get("id") for entry in layers if isinstance(entry, dict) and isinstance(entry.get("id"), str)} if isinstance(layers, list) else set()
            if not ids.intersection(BASEMAP_LAYERS):
                raise ValueError("PMTiles metadata does not describe a Protomaps-compatible basemap")
            min_zoom, max_zoom = header[100:102]
            bounds = [value / 1e7 for value in struct.unpack_from("<4i", header, 102)]
            center = [value / 1e7 for value in struct.unpack_from("<2i", header, 119)]
            west, south, east, north = bounds
            if not (0 <= min_zoom <= max_zoom <= 26 and -180 <= west < east <= 180 and -90 <= south < north <= 90
                    and west <= center[0] <= east and south <= center[1] <= north and min_zoom <= header[118] <= max_zoom):
                raise ValueError("Invalid PMTiles bounds, center or zoom levels")
            return {"size": size, "bounds": bounds, "center": center, "min_zoom": min_zoom, "max_zoom": max_zoom, "layers": sorted(ids)}
    except (OSError, ValueError, struct.error, EOFError) as exc:
        raise ValueError(f"{path.name}: {exc}") from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class MapDiscovery:
    def __init__(self, directory: Path):
        self.directory = directory
        self.cache = {}
        self.lock = threading.Lock()

    def discover(self, hashes=False):
        with self.lock:
            return self._discover(hashes)

    def _discover(self, hashes):
        result = []
        root = self.directory.resolve()
        entries = REGIONS + ((("philippines", "Philippines"),) if (root / "philippines.pmtiles").exists() else ())
        for region_id, name in entries:
            item = {"id": region_id, "name": name, "filename": f"{region_id}.pmtiles",
                    "path": f"/maps/{region_id}.pmtiles", "size": None, "sha256": None, "available": False}
            try:
                path = (root / item["filename"]).resolve()
                if path.parent != root or not path.is_file():
                    item["error"] = "Not installed"
                else:
                    stat = path.stat()
                    key = (str(path), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
                    cached = self.cache.get(region_id)
                    if cached is None or cached[0] != key:
                        metadata = inspect_archive(path)
                        if region_id == "philippines":
                            west, south, east, north = metadata["bounds"]
                            if west > 116.9 or south > 4.5 or east < 126.7 or north < 21.2 or not BASEMAP_LAYERS.issubset(metadata["layers"]):
                                raise ValueError("Philippines archive lacks required country coverage or basemap layers")
                        cached = (key, metadata)
                        self.cache[region_id] = cached
                    if hashes and "sha256" not in cached[1]:
                        cached[1]["sha256"] = sha256_file(path)
                    after = path.stat()
                    if (str(path), after.st_size, after.st_mtime_ns, after.st_ctime_ns) != key:
                        self.cache.pop(region_id, None)
                        raise ValueError("Map file changed during inspection; retry")
                    item.update(cached[1], available=True)
            except (ValueError, OSError, RuntimeError) as exc:
                item["error"] = str(exc)
            result.append(item)
        return result
