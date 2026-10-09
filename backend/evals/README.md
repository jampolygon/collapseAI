# CollapseAI command-line evaluation

Run 15 English/Taglish survival, uncertainty, arithmetic, and unsafe-assumption
questions against a separately installed llama.cpp server. Compare multiple GGUF
models without interacting with the browser. **The frontend is unchanged.**

Python 3.10+ is required. There are **no pip dependencies**, web frameworks,
cloud judges, or model downloads in this harness. All commands below run from
the repository root; defaults resolve relative to the script, not the current
working directory. Model paths you provide resolve from your working directory.

## Install llama-server separately

Download a Windows build for your hardware from the official
[llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases), and extract
its executable and companion libraries together. Or follow the official
[build guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
For an MSVC build, run these in the cloned llama.cpp repository from a Visual
Studio developer terminal with CMake and the C++ toolchain installed:

```powershell
cmake -B build
cmake --build build --config Release --target llama-server
```

Find `llama-server.exe` in the build output (typically `build/bin/Release` for
MSVC). Obtain a compatible GGUF separately, such as a file from a model URL in
`frontend/src/lib/catalog.ts`. The harness never installs or downloads a model.
Keep the same llama.cpp build across comparisons and record its version yourself.

The harness uses `/health`, `/v1/models`, and `/v1/chat/completions` from the
[official server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
An older server without chat completions or a suitable model template returns an
explicit error; there is no silent fallback to an unrelated completion prompt.

## Existing server

If the server is already running:

```powershell
python backend/evals/run_eval.py --server http://127.0.0.1:8080
```

`http://127.0.0.1:8080/v1` is accepted too. The harness waits for health and
discovers the model ID. If discovery is unsupported or the server lists several
models, select one explicitly:

```powershell
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --model-name my-model
```

Set the `LLAMA_API_KEY` environment variable if that server requires a bearer
token. The token is not saved in reports. An existing server is never stopped.

## One model / multiple models sequentially

```powershell
python backend/evals/run_eval.py --llama-server "C:\llama\llama-server.exe" --models "C:\models\model-a.gguf"

python backend/evals/run_eval.py --llama-server "C:\llama\llama-server.exe" --models "C:\models\model-a.gguf" "C:\models\model-b.gguf" "C:\models\model-c.gguf"
```

For each GGUF the harness starts a hidden server bound to localhost, waits for
health, evaluates the questions, and stops/reaps that process before moving on.
Startup failure is recorded for that model and the next model is attempted.
Input files and executable availability are validated before launch. The default
port is automatically chosen; an occupied explicitly selected port is rejected.
Windows launches use a separate process group and no visible console window.
Cleanup tries a graceful signal, then terminate/kill with bounded waits. Ctrl+C
stops the owned server and saves a partial report; no process is killed by name.

Default launch settings: context 4096, batch 512, one parallel slot, Jinja
templates, and **CPU-only** GPU layers 0. To change the hardware comparison:

```powershell
python backend/evals/run_eval.py --llama-server "C:\llama\llama-server.exe" --models "C:\models\model-a.gguf" --gpu-layers -1 --threads 8 --startup-timeout 300
```

Other optional server flags can be passed one token at a time using repeated
`--server-arg=--flag --server-arg=value`. Host, port, model, and alias overrides
are rejected. Use a recent server supporting the launch flags, or launch an
older server manually and use `--server`. Startup logs accompany reports.

## Prompt and inference settings

The system prompt is read **directly from `const SYSTEM` in
`frontend/src/lib/ask.ts` on every run**. Edit that location to change both the
production prompt and the harness's next run. The extractor accepts only a plain
template literal and fails clearly if interpolation/escapes are introduced.

For an eval-only experiment, use `--prompt backend/evals/my_prompt.txt` with a
UTF-8 text file. It overrides only the system message, not the frontend. There is
no separately maintained copy of the system prompt. The reference wrapper and
empty-reference fallback are small, documented duplicates in
`benchmark.py:build_messages`; update those if Ask's user-message format changes.
Questions are independent messages, as in the current Ask implementation.

Defaults: temperature **0**, seed **42**, generated-token limit **400**. Use
`--temperature 0.3` to match the frontend sampling temperature. Deterministic
settings reduce variance but do not guarantee identical output across hardware
or llama.cpp versions. Token-limit truncation fails the answer checks even if
required keywords have already appeared.

Qwen3.5 names automatically receive `chat_template_kwargs.enable_thinking=false`,
matching the frontend catalog. Renamed models and custom templates can override:

```powershell
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --chat-template-kwargs '{"enable_thinking": false}'
```

`--chat-template-kwargs '{}'` suppresses the automatic override. Reports record
the effective template options. This harness does not emulate wllama-specific
load parameters such as `reasoning: false`.

## RAG versus no-RAG

```powershell
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --top-k 3
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --no-rag
python backend/evals/run_eval.py --server http://127.0.0.1:8080 --pack-ids first-aid survival disasters --top-k 5
```

RAG loads generated files from `frontend/public/packs/`. `--no-rag` skips packs
and sends just the question with the **same** system prompt. That prompt still
asks for source-grounded answers, so raw-model refusals are expected and should
be reviewed rather than treated as a generic model-knowledge leaderboard.
There is no extra refusal/safety instruction added specifically for trap questions.

The Python retriever is **an approximation, not MiniSearch parity**:

- It reads the production `TAGLISH` dictionary directly from `knowledge.ts`.
  Unsupported dictionary syntax fails clearly instead of using a stale copy.
- It mirrors paragraph chunking, the 600-character threshold, UTF-16 length
  counting, passage IDs, title/category/text fields, and 3 / 1.5 / 1 boosts.
  Long paragraphs stay long, matching the current browser behavior.
- It uses Unicode alphanumeric tokens, independent per-field BM25 with
  `k1=1.2`, `b=0.75`, and OR accumulation. This differs from MiniSearch's indexing,
  BM25 variant, term combination, tokenizer, normalization, and scoring.
- Prefix matches have weight 0.8; edit-distance matches have weight 0.6 and a
  floor(length x 0.15) allowance. These expansion weights/fuzzy details differ
  from MiniSearch. Duplicate expanded query terms are deduplicated.
- Equal scores use input order. Default pack order is alphabetical, whereas
  the frontend follows catalog order and indexes only device-downloaded packs.
  Use `--pack-ids` to match a device's selection and order more closely.

Use comparisons to shortlist prompts/models, then verify retrieval and answers
in the actual browser. Native server timing is not an estimate of phone/WASM
performance. No prompt token cap beyond the selected server context is invented.

## Edit benchmarks and checks

Edit `questions.json`, an array of 15 records. Required fields:
`id`, `category`, `language`, `question`, `expected_behavior`, `must_include`,
`must_not_include`. IDs must be unique. `notes` and `expected_source_ids` are optional.
Language is metadata, not a language-classifier test.

```json
{
  "id": "custom_001",
  "category": "preparedness",
  "language": "taglish",
  "question": "Ano dapat laman ng go-bag namin?",
  "expected_behavior": "Use downloaded essentials; answer in English.",
  "must_include": ["water", {"any_of": ["first aid", "first-aid"]}],
  "must_not_include": [{"regex": "an unsafe affirmative assertion"}],
  "expected_source_ids": ["disasters/go-bag-and-family-plan"],
  "notes": "Review priority order manually."
}
```

Strings are case-insensitive substring checks after Unicode NFKC and whitespace
normalization. `any_of` matches any listed phrase; `regex` uses Python's
case-insensitive regex against normalized answer text. Every must-include rule
must match; no must-not-include rule may match. These checks do **not** understand
negation, quoted assertions, medical validity, or claim-to-source support. Full
answers, rules, failed checks, and references are retained for review. The trap
labels are provisional review criteria; they do not certify the existing packs.
Water and poisoning notes link to [CDC water guidance](https://www.cdc.gov/water-emergency/about/index.html)
and [Poison Control first-aid guidance](https://www.poison.org/first-aid-for-poisonings).

`expected_source_ids` uses `pack/article` without a chunk suffix. All listed
articles must appear among retrieved passages. Retrieval checks are shown
separately from **answer pass counts** and are not evaluated in no-RAG mode.

## Reports, errors, and exit status

Default output: `backend/evals/results/<UTC-timestamp>-<unique-id>.json` and `.md`.
Owned-server `.log` files share that prefix. Generated outputs are ignored by Git;
`.gitkeep` preserves the directory. Custom `--output-dir` locations are your choice
and may need their own ignore rule. No synthetic results are shipped as benchmarks.

JSON is atomically checkpointed after each attempted question and finalized with
summary/configuration, source file hashes, model identity, prompts, full answers,
references with IDs/titles/text/scores, answer and retrieval failures, errors,
usage/timings, and latencies. Markdown includes model/per-question comparison
tables followed by full answers and reference passages. An interrupted report
counts only completed/attempted rows and says that it is incomplete.

Total per-question latency includes retrieval, HTTP, parsing, and text checks;
response latency isolates HTTP/parsing. Startup is excluded. Summary average
latency includes attempted request failures; unattempted startup-failure rows
have no latency. Generation tok/s uses server timing fields only (or predicted
tokens divided by predicted milliseconds). It is never fabricated from total
HTTP latency; absent statistics are `null`/`n/a`. Prompt cache reuse is visible in
the raw timing/usage objects and can influence results.

A failed request is recorded and the next question continues. Malformed input
fails before any inference; invalid model files fail input validation. A startup
failure creates explicit error rows, never fake inference passes. The HTTP
`--timeout` is a socket timeout, not a hard wall-clock cutoff for a streaming
peer; the harness requests non-streaming responses. `--startup-timeout` bounds
the readiness polling deadline.

Exit codes: `0` completed without request/startup errors; `1` request/startup
errors; `2` invalid input/configuration/output I/O; `130` Ctrl+C.
Add `--fail-on-checks` to also return `1` for failed answer or retrieval checks.

## Local verification

```powershell
python -m compileall -q backend/evals
python backend/evals/run_eval.py --help
python -m unittest discover -s backend/evals/tests -v
```

The tests use temporary outputs and explicitly marked synthetic HTTP responses.
They cover malformed questions/packs/responses, timeout, continuation, output
tables, source IDs, prompt extraction, no-RAG messages, unavailable servers,
occupied ports, cleanup escalation, and interrupted partial reports. They do
not exercise a real GGUF or certify Windows llama-server signal handling.
No local server/model was found during implementation, so real inference and
native model startup were not tested. No Python type checker is configured in
the repository; syntax compilation and standard-library unit tests were run.
