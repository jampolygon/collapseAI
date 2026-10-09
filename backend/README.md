# CollapseAI backend tooling

This folder contains the Python knowledge pack builder and its Markdown sources.
The application runs offline in the browser; there is currently no HTTP API,
database, cloud inference service, or LAN hub server to start.

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
Generated packs are written to `../frontend/public/packs/*.json` and should be
committed with the source content. Their URLs remain `packs/<id>.json` in the app.
The shared format is defined by `Pack` and `Article` in
`../frontend/src/lib/knowledge.ts`.

A LAN hub is a future feature described in `../PLAN.md`; add it here if implemented.

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
