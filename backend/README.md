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
