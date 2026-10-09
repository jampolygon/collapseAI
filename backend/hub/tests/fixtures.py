"""Synthetic archive structure for tests only; no geographic map data."""
import json
import struct

def synthetic_archive(layer_ids=("earth",)):
    """Structurally readable single-tile fixture, NOT a geographic basemap."""
    root = bytes([1, 0, 1, 2, 1])
    metadata = json.dumps({"vector_layers": [{"id": layer_id} for layer_id in layer_ids]}).encode()
    header = bytearray(127)
    header[:8] = b"PMTiles\x03"
    struct.pack_into("<11Q", header, 8, 127, len(root), 127 + len(root), len(metadata),
                     127 + len(root) + len(metadata), 0, 127 + len(root) + len(metadata), 2, 1, 1, 1)
    header[96:102] = bytes([1, 1, 1, 1, 0, 0])
    struct.pack_into("<4i", header, 102, 1160000000, 40000000, 1270000000, 220000000)
    header[118] = 0
    struct.pack_into("<2i", header, 119, 1210000000, 140000000)
    return bytes(header) + root + metadata + b"\x1a\x00"

