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

The project ships a skill for agents driving the app end-to-end: `.claude/skills/agent4novel-drive`.

Run a single test: `pnpm --filter @agent4novel/server exec vitest run test/pipeline.test.ts` (or `@agent4novel/web`, `@agent4novel/contracts`).

Model key: without `DEEPSEEK_API_KEY` the server runs in demo mode with FakeStep (sample content, no model calls). `export DEEPSEEK_API_KEY=sk-...` enables the real DeepSeek model.

## Architecture

pnpm monorepo: `packages/contracts` (zod schemas + types, the shared contract), `apps/server` (Hono + Vercel AI SDK v7, `@ai-sdk/deepseek`), `apps/web` (React 19 + Vite: 书架 Bookcase / 统一入口 Entry / 创作界面 Workspace). Contracts exports raw `.ts` — no build step.

The system is a **human-in-the-loop pipeline**: machines generate, the author gates everything. Three core pieces:

- **Pipeline** (`apps/server/src/pipeline/pipeline.ts`) — the orchestrator and the only owner of flow control. Steps run in a fixed `PipelineDefinitionEntry[]` order; each entry declares `outputKind` and optional `consumes` (explicit upstream deps — latest version must be `approved`) / `gateAfter` (output lands as `pending`, next step blocked until approved) / `gateBefore`. Stage (`ready | blocked | awaiting-approval | complete`) is **derived from artifact status**, not stored. `advance()` is chained (runs auto-approved steps until the next gate) under a per-work mutex, and returns an exhaustive outcome (`advanced | awaiting-approval | complete | failed`).
- **Steps** (`apps/server/src/steps/`) — contract-bound AI generations executed via `runStep`, which zod-validates both input and output. Steps don't know their position in the pipeline. Prompts live in `steps/skills/<step>/SKILL.md` files (ADR-0002) — prompt iteration never touches code. Real steps call the model via `steps/llm-call.ts` (`generateObject` + timeout + typed LLM errors); oversized seeds are truncated there, in one place.
- **Artifacts** (`store/`) — append-only version chains keyed by `{kind, chapter?}`; `appendArtifact` bumps `version`, old versions stay. For `creative`: saving a draft = new version + `pending`; explicitly selecting a direction = single-direction new version + `approved`.

Two deliberate seams: **storage** (`WorkStore` interface — `InMemoryStore` now, `SQLiteStore` planned in issue #9) and **model** (AI SDK `createProviderRegistry` in `steps/llm.ts` — switching providers is a string prefix). Tests run the whole chain on FakeStep.

Currently the pipeline definition wires `caption` (提炼稿, auto-approved) → `creative` (创意稿 direction packs, `gateAfter` = compare view) (see `apps/server/src/index.ts`); outline/setting/beat/prose contracts exist but their steps are not yet registered.

## Data model

`docs/schema.md` is the single source of truth. Artifact kinds map 1:1 to pipeline nodes: `caption` (提炼稿: inputStage + summary + elements + gaps), `creative` (创意稿: `directions[]` of hint-level packs with server-injected `directionId`), `outline`, `setting` (per-work), `beat`, `prose` (per-chapter). Invariants: per-work kinds never have `chapter`; per-chapter kinds always do. 卖点/梗概 are **not** standalone artifacts — they live inside a creative pack (`hook`/`payoffs`/`synopsis`).

## Documentation conventions (this repo is docs-for-agents)

- `CONTEXT.md` — domain glossary. Use its exact terms (脑洞, 卖点, 梗概, 大纲, 章纲, 正文, 设定, 关卡…); each entry lists forbidden synonyms — don't introduce them.
- `docs/wiki/NNNN-<slug>.md` — per-ticket tech plans (NNNN = GitHub issue number), the **only** source of HOW, with a fixed template and a 状态记录 log appended over time. Before implementing a ticket: read the issue → read its wiki. If wiki and code drift, code wins and you fix the wiki.
- `docs/adr/` — irreversible decisions; new ones become new ADRs, wiki only links.
- Issues are managed via `gh` CLI with five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); see `docs/agents/`.

## Language

Code identifiers and user-facing English docs are English; domain docs (CONTEXT.md, schema.md, wiki) are Chinese, and code comments are often Chinese. Match the language of the file you're editing. Keep README.md (English) and README.zh-CN.md in sync.
