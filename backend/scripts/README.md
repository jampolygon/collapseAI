# Pack Builder v2

Map provisioning is separate: `build_maps.py` wraps the external go-pmtiles CLI
against local archives. See [the map audit/guide](../../docs/OFFLINE_MAPS.md).
It does not download source maps or extend the pack resource manifest.

Build validated knowledge packs and an exact-byte resource manifest using only
Python 3.10+ and the standard library. The builder also preserves the newer Node
pack metadata (`tags`, `disaster_types`, `last_verified`, `keywords`, `updated`).
Explicit `updated` or pack `last_verified` dates make that metadata deterministic.
Node builds refresh existing manifest pack hashes; run Python after model catalog
edits to regenerate model metadata. Browser downloads remain independent.

From the repository root:

```powershell
python backend/scripts/build_packs.py
# Existing shortcut also generates the resource manifest:
npm run packs

python -m unittest discover -s backend/scripts/tests -v
python -m compileall -q backend/scripts
```

The builder reads `backend/content/*.md` and, if present, JSON pack source files.
It writes `frontend/public/packs/<id>.json` and
`frontend/public/manifest.json`. This resource manifest is separate from the PWA's
`manifest.webmanifest`; the app does not consume the resource manifest yet.

## Markdown and JSON source validation

Markdown uses the existing front matter and article-heading format:

```markdown
---
id: first-aid
name: First Aid
license: Team content
version: 1
---

# Severe bleeding
category: First aid
source: Team reference

Article text, with blank lines between paragraphs.
```

- Pack `id`, `name`, and positive integer `version` are required in JSON. Markdown
  requires `id`/`name` and defaults version to 1, preserving existing packs.
- `articles` must be a nonempty array of objects. Every article needs nonempty
  string `id`, `title`, `category`, and `text`. Markdown requires explicit category;
  IDs retain the existing ASCII title-to-slug algorithm.
- Pack/article IDs must be lowercase ASCII hyphenated slugs. Duplicate article
  IDs/slugs within a pack and duplicate pack IDs across source files are errors.
  Punctuation/case-equivalent Markdown headings can collide and are rejected.
- `source` remains optional, matching the runtime schema; when present it must be
  a string. Markdown still emits an empty source if omitted. `license` is optional
  and must be a string when present. This is structural validation, not an audit
  of provenance, licensing, or clinical accuracy.
- Malformed/duplicate Markdown metadata, missing article headings, unexpected
  pre-heading text, empty article bodies, malformed JSON, duplicate JSON keys,
  non-finite JSON values, and invalid UTF-8 produce contextual errors. Markdown
  heading/metadata errors include source line numbers. Multiple bad source files
  are reported together before any outputs are modified.
- The current model catalog is read, never executed or changed. Literal IDs,
  friendly names, and URLs (including the existing `${HF}` prefix) are supported.
  Unsupported catalog layout/expressions and duplicate model IDs fail explicitly;
  this is a small reader for the current catalog, not a TypeScript parser.

## Content limits

```powershell
python backend/scripts/build_packs.py --max-passage-chars 1000 --max-article-chars 20000
```

Validation mirrors the frontend's current paragraph chunk boundaries with a
**600-character target**. Long paragraphs are not split or rewritten. The hard
passage maximum defaults to **1,000 UTF-16 code units** and full article text to
**20,000 UTF-16 code units**; both are configurable positive integers. UTF-16
counting matches JavaScript string length, including two units for emoji.

The largest existing passage is 794 units. Setting the maximum to 600 will reject
some current passages; the browser's 600 target is not a strict maximum. The
check also catches the two-character paragraph separator at boundary cases.
Break long paragraphs with blank lines or consciously adjust the limit. Neither
pack content nor frontend chunking is automatically changed by these settings.

Custom staging paths are available:

```powershell
python backend/scripts/build_packs.py --source-dir backend/content --output-dir staging/public/packs --manifest staging/public/manifest.json
```

Public resource paths in the manifest use `/packs/<id>.json` by convention.
`--catalog` can select a different compatible catalog for staging/tests.

## Resource manifest schema

```json
{
  "schema_version": 1,
  "builder_version": 2,
  "packs": [
    {
      "id": "first-aid",
      "path": "/packs/first-aid.json",
      "size": 9886,
      "sha256": "<64 lowercase hexadecimal characters computed from the file>",
      "articles": 10,
      "version": 1
    }
  ],
  "models": [
    {
      "id": "qwen35-0.8b",
      "name": "Spark",
      "url": "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf",
      "size": null,
      "sha256": null
    }
  ]
}
```

Pack `size` is the byte count of the actual UTF-8 JSON file, not a catalog estimate
or character count. SHA-256 covers those exact bytes. `articles` is a count, and
`version` is the pack format/content version (currently 1). Model size/hash are
explicitly unknown: catalog `sizeMB` estimates are not treated as real file sizes.
No model files, network requests, or model downloads are needed or attempted.

## Determinism and publication

Identical input/catalog/settings produce identical pack and manifest bytes.
Outputs use explicit UTF-8 and LF line endings across platforms. Source ordering
and manifest pack ordering are stable; article ordering and original pack field
ordering are preserved. There is no wall-clock timestamp in generated files;
schema/builder/pack versions provide stable version metadata.

All sources, catalog entries, serialized JSON, and JSON round trips are validated
before publishing. Files use verified temporary writes and atomic per-file
replacement. Published pack sizes/hashes are rechecked before the manifest is
written last. Filesystem errors fail with a nonzero exit. This is not a multi-file
transaction: an I/O failure halfway through publication may replace some packs,
but the new manifest is not published. Rerun a successful build before deployment.
Existing stale files are left untouched; the manifest lists this build's packs.

Keep generated packs and the manifest together in source control/deployment.
Wikipedia ingestion, local model hashing, and browser download verification are
not implemented here. Tests cover validation, duplicate IDs, missing fields,
oversized content, exact hashes/sizes, determinism, and invalid output. Models'
remote availability and a live hosted manifest have not been tested.
