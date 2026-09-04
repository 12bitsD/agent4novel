# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # pnpm workspaces (apps/* + packages/*)
pnpm dev              # server :8787 (tsx watch) + web :5173 (vite), in parallel
pnpm test             # vitest, all workspaces; fully faked, never networked
pnpm typecheck
pnpm build
pnpm -s cli <cmd>     # CLI for driving the whole pipeline (or ./apps/cli/bin/a4n, cleaner stdout)
```

The project ships an end-to-end operating skill at `.claude/skills/agent4novel-drive/SKILL.md`. Read it before starting the app, changing model configuration, running CLI cases, or diagnosing LLM failures.

Before planning, implementing, debugging, or reviewing existing behavior, use `.claude/skills/agent4novel-wiki/SKILL.md` to locate the minimum relevant ticket context. Use the same skill when creating or updating `docs/wiki/` so design intent and change reasons survive implementation.

Run a single test: `pnpm --filter @agent4novel/server exec vitest run test/pipeline.test.ts` (or `@agent4novel/web`, `@agent4novel/contracts`).

Model runtime rules live in `docs/wiki/016-model-runtime-provider-config.md`; use the Wiki skill to read only the relevant configuration, provider, credential, URL, or timeout section. Never put a credential inline in a command or print `.env.local`.

## Architecture

pnpm monorepo: `packages/contracts` (zod schemas + types, the shared contract), `apps/server` (Hono + Vercel AI SDK v7, `@ai-sdk/deepseek` + `@ai-sdk/openai-compatible`), `apps/web` (React 19 + Vite: 书架 Bookcase / 统一入口 Entry / 创作界面 Workspace). Contracts exports raw `.ts` — no build step.

The system is a **human-in-the-loop pipeline**: machines generate, the author gates everything. Three core pieces:

- **Pipeline** (`apps/server/src/pipeline/pipeline.ts`) — the orchestrator and the only owner of flow control. Steps run in a fixed `PipelineDefinitionEntry[]` order; each entry declares `outputKind` and optional `consumes` (explicit upstream deps — latest version must be `approved`) / `gateAfter` (output lands as `pending`, next step blocked until approved) / `gateBefore`. Stage (`ready | blocked | awaiting-approval | complete`) is **derived from artifact status**, not stored. `advance()` is chained (runs auto-approved steps until the next gate) under a per-work mutex, and returns an exhaustive outcome (`advanced | awaiting-approval | complete | failed`).
- **Steps** (`apps/server/src/steps/`) — contract-bound AI generations executed via `runStep`, which zod-validates both input and output. Steps don't know their position in the pipeline. Prompts live in `steps/skills/<step>/SKILL.md` files (ADR-0002) — prompt iteration never touches code. Real steps call the model via `steps/llm-call.ts` (`generateObject` + provider-available JSON mode + local schema validation + timeout + typed LLM errors); oversized seeds are truncated there, in one place.
- **Artifacts** (`store/`) — append-only version chains keyed by `{kind, chapter?}`; `appendArtifact` bumps `version`, old versions stay. For `creative`: saving a draft = new version + `pending`; explicitly selecting a direction = single-direction new version + `approved`.

The deliberate runtime seams are **storage** (`WorkStore` interface — `InMemoryStore` now, `SQLiteStore` planned in issue #9), **step implementation** (FakeStep/RealStep), and **model runtime** (`ModelRuntime` in `steps/llm.ts`, backed by an AI SDK provider registry). `A4N_MODEL` supplies the startup default; `Work.config.model` is the internal per-work override seam, with no public UI/API yet. Tests use fakes or mocked transports and never call a real provider.

The current pipeline definition wires `caption` (提炼稿, auto-approved) → `creative` (创意稿 direction packs, `gateAfter` = compare view) → `outline` (大纲, `gateAfter` = review). Assembly lives in `apps/server/src/start.ts`; `apps/server/src/index.ts` only loads `.env.local` before dynamically importing it. Setting/beat/prose contracts exist but their steps are not yet registered.

## Data model

`docs/schema.md` is the single source of truth. Artifact kinds map 1:1 to pipeline nodes: `caption` (提炼稿: inputStage + summary + elements + gaps), `creative` (创意稿: `directions[]` of hint-level packs with server-injected `directionId`), `outline`, `setting` (per-work), `beat`, `prose` (per-chapter). Invariants: per-work kinds never have `chapter`; per-chapter kinds always do. 卖点/梗概 are **not** standalone artifacts — they live inside a creative pack (`hook`/`payoffs`/`synopsis`).

## Documentation conventions (this repo is docs-for-agents)

- `CONTEXT.md` — domain glossary. Use its exact terms (脑洞, 卖点, 梗概, 大纲, 章纲, 正文, 设定, 关卡…); each entry lists forbidden synonyms — don't introduce them.
- `docs/wiki/NNN-<slug>.md` — per-ticket engineering context: original purpose, technical/code landing, reasons for changes, and the handoff boundary. Use the Wiki skill for selective reading and updates; verify current executable behavior in code and tests.
- `docs/adr/` — irreversible decisions; new ones become new ADRs, wiki only links.
- `docs/agents/ticket-completion-checklist.md` — canonical gate from ticket scope and TDD planning through review, PR/merge, and remote verification. Read it before starting, reviewing a candidate or attestation, or completing a ticket.
- Issues are managed via `gh` CLI with five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); see `docs/agents/`.

## Language

Code identifiers and user-facing English docs are English; domain docs (CONTEXT.md, schema.md, wiki) are Chinese, and code comments are often Chinese. Match the language of the file you're editing. Keep README.md (English) and README.zh-CN.md in sync.
