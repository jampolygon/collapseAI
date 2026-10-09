# CollapseAI backend tooling

This folder contains knowledge pack tooling, the evaluation harness, map
provisioning tooling and an optional FastAPI LAN Hub. The core application runs
offline in the browser without any backend service.

Requires Python 3.10 or newer. The builder uses only the standard library.

From the repository root:

```sh
npm run packs
# Or without Node.js:
python backend/scripts/build_packs.py
```

From this folder:

```sh
python scripts/build_packs.py
```

Edit `content/*.md` using the existing front matter and article headings.
Generated packs are written to `../frontend/public/packs/*.json`, with exact sizes
and hashes in `../frontend/public/manifest.json`. Commit both with the source content.
Their URLs remain `packs/<id>.json` in the app; the new manifest is not consumed yet.
The shared format is defined by `Pack` and `Article` in
`../frontend/src/lib/knowledge.ts`.

See [hub/README.md](hub/README.md) for optional local file serving and llama-server
proxying, and [../docs/OFFLINE_MAPS.md](../docs/OFFLINE_MAPS.md) for the existing
map architecture, fixes, extraction and remaining device tests.

Pack Builder v2 validates required fields, duplicate IDs, source syntax, and
configurable article/passage limits. See [scripts/README.md](scripts/README.md)
for the manifest schema, determinism, configuration, and unit-test commands.

## Evaluation harness

`evals/` benchmarks production-style prompts and approximate knowledge retrieval
against a separately installed llama.cpp server. It uses Python's standard
library and leaves the browser runtime and pack builder unchanged.

```sh
python backend/evals/run_eval.py --server http://127.0.0.1:8080
```

Run the command above from the repository root. See [evals/README.md](evals/README.md)
for sequential GGUF model testing, benchmark editing, output reports, and the
retrieval differences from MiniSearch.
