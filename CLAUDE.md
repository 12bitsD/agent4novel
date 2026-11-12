# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Commands

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r apps/backend/requirements.lock
.venv/bin/python -m pip install -e 'apps/backend[dev]'
pnpm install --frozen-lockfile
pnpm dev              # FastAPI :8787 + Vite :5173
pnpm test             # Python backend + TypeScript contracts/Web; local fakes and loopback only
pnpm typecheck        # mypy + ruff + TypeScript
pnpm build            # Python wheel + compiled Web
pnpm -s cli <cmd>     # or .venv/bin/a4n <cmd>, for a machine-readable JSON stdout
```

The project ships an end-to-end operating skill at `.claude/skills/agent4novel-drive/SKILL.md`. Read it before starting the app, changing model configuration, driving CLI cases, or diagnosing LLM failures. Read `.claude/skills/agent4novel-wiki/SKILL.md` before planning, implementing, debugging or reviewing existing behavior, and use it when maintaining `docs/wiki/`. Complete `docs/agents/ticket-completion-checklist.md` before reviewing or delivering a ticket.

Model configuration belongs to `docs/wiki/016-model-runtime-provider-config.md`. Never print credentials or `.env.local`. Real Provider calls require explicit configuration; tests use fakes, mocked transports or loopback SSE.

## Architecture

- `apps/backend` — the production FastAPI application, Pydantic contracts, Python CLI, SQLite stores and native Nextloop model runtime. `a4n-api` serves the API and compiled Web; `a4n` drives works or isolated steps.
- `apps/web` — the React/Vite author interface.
- `packages/contracts` — TypeScript/Zod schemas for the frontend. Python owns the production HTTP and CLI contracts; cross-language golden fixtures and real API/CLI tests protect the shared wire behavior. Do not reintroduce a second production backend or a stdio worker.

The human-in-the-loop pipeline generates Caption → Creative → Outline → Setting, then a Beat and Prose for each explicitly started chapter. Artifact status, not a persisted workflow field, determines the next action. Human approval uses the dedicated finalize/save/select commands; append/save creates a new identity and version in the normal case, while finalize keeps identity, version and creation time.

The deliberate seams are storage (`SqliteStore` for production and `InMemoryStore` for behavior tests), step implementations and `ModelRuntime`. Model calls happen outside database transactions. Conditional writes revalidate the current head and consumed inputs in a short SQLite transaction. Generation never auto-retries at the Pipeline or CLI level; provider retry budgets belong to the individual Step.

`apps/backend/src/agent4novel/agent/` contains the six production Steps and their packaged `skills/<step>/SKILL.md`. Nextloop is called in-process with an empty tool registry and per-run in-memory events. It is not a tool-calling agent or a Work Wiki/Memory integration. `run-step` uses the same Step and schemas without creating a WorkStore or claiming that supplied upstream is the current approved head.

## Data and recovery

`docs/schema.md` owns the current data model and `CONTEXT.md` owns domain terminology. `docs/adr/` records long-lived architecture decisions; per-ticket rationale and implementation history live in `docs/wiki/NNN-*.md`.

SQLite v1–v4 migrations are strict. Works, all artifact versions, status and input references persist under `A4N_DATA_DIR`. Prompt/Skill files have immutable content hashes and private filesystem permissions. Unknown writes require exact request/head/content matching and bounded readback; never infer `not-committed` from a timeout, 5xx or malformed response. `run-step --record-dir` creates a new private directory containing only `input.json`, `invocation.json`, `result.json` and `meta.json`; `comments.md` remains optional adjacent material.

## Documentation conventions

- Keep `README.md` and `README.en.md` synchronized; `README.zh-CN.md` retains the Chinese navigation entry.
- Update `docs/handoff.md` only for the verified current milestone, limitations and next step. Do not rewrite historical acceptance evidence as if it were a new result.
- Follow `docs/agents/ticket-completion-checklist.md` for review and delivery. Issues use the canonical triage labels in `docs/agents/`.
- Code identifiers and user-facing English docs are English; domain docs are Chinese. Match the surrounding file.
