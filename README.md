<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel: spark → gate → book" width="300">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">
  <strong>From a one-line idea to a finished web-novel serial.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">Pipeline</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#docs">Docs</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="./README.zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/demo_mode-no_API_key_needed-brightgreen" alt="Demo mode: no API key needed">
  <img src="https://img.shields.io/badge/AI_SDK-v7-000000" alt="AI SDK v7">
</p>

---

Novel writing has long been a cottage craft: one author, one pen, hundreds of thousands of characters ground out word by word. agent4novel moves it onto a collaborative workflow — the AI works like an on-call editorial team, developing creative directions, structuring the outline, and filling out the setting; you are the editor-in-chief, with the final say at every author-facing gate. The goal: raw inspiration in, a finished book out.

It is built for authors who have ideas but no writing training. The current chain turns a one-line idea (or an uploaded setting doc) into a distilled caption, creative directions to compare and pick, a book outline, and a complete setting and first-chapter Beat to edit and approve. [#5](https://github.com/12bitsD/agent4novel/issues/5) implements Beat editing and regeneration; prose remains separate future work in [#22](https://github.com/12bitsD/agent4novel/issues/22). The app and its store run locally: demo mode never calls a model service, while live mode sends the generation inputs to your configured model provider, whose privacy terms then apply.

## Quick start

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

Open <http://localhost:5173>. No API key needed to try it: without one, the app runs in demo mode, where a built-in fake produces sample content and no real model is called.

With a real model (DeepSeek, or LongCat through its OpenAI-compatible Chat Completions endpoint):

```bash
cp .env.example .env.local
chmod 600 .env.local
# edit .env.local: set A4N_MODEL and the matching provider API key
pnpm dev
```

The server loads `.env.local` at startup and Git ignores it; environment variables already supplied by the shell or CI take precedence. If `A4N_MODEL` is explicit, its provider key is required. Without an explicit model, the server selects an available provider in this order: DeepSeek → LongCat → demo mode. Model IDs use `provider:model`, for example `longcat:LongCat-2.0` or `deepseek:deepseek-chat`.

Credentials, base URLs, and provider adapters remain server-only. `Work.config.model` is an internal per-work override seam; there is no public UI or API for changing it yet. The current LongCat adapter targets its documented Chat Completions surface, not blanket compatibility with every OpenAI protocol such as Responses. See [wiki 016](./docs/wiki/016-model-runtime-provider-config.md) for the configuration contract, safety rules, and verified cases.

LongCat defaults to thinking disabled, temperature `0.9`, and top-p `0.95`. Single-step experiments can override these through a config file or CLI flags; see [generation parameters](./docs/wiki/016-model-runtime-provider-config.md#生成参数与单节点覆盖).

### CLI (for scripts and agents)

Generation and review are also drivable from the command line — stdout is always pure JSON:

```bash
./apps/cli/bin/a4n smoke --seed-file seed.txt   # full chain through edited Setting and Beat approval
./apps/cli/bin/a4n list                         # create / get / advance / select / approve / logs …
./apps/cli/bin/a4n get work-1 --kind setting    # replace work-1 with your work ID
./apps/cli/bin/a4n approve-setting work-1 --file setting-request.json
```

`setting-request.json` contains the complete `{ content, expectedHeadVersion }` request. Keep the version from the setting you reviewed: `approve-setting` never replaces it with the latest version. Automatic version lookup remains limited to `select` and `save-outline`; `smoke` exercises an actual setting edit before approval.

Beat CLI also supports `get <workId> --kind beat --chapter 1`, `regenerate-beat <workId> --file request.json`, and `approve-beat <workId> --file request.json`. Files require `chapter: 1`, `expectedArtifactId`, `expectedHeadVersion`, and complete `content`; regeneration additionally requires `instructions` (which may be empty). It preserves the reviewed baseline and never automatically resubmits an uncertain write. See [Wiki 005](./docs/wiki/005-beat-generation-review.md).

Run one production step with supplied inputs or a custom system prompt:

```bash
./apps/cli/bin/a4n run-step caption --seed-file seed.txt \
  --system-prompt-file caption-sp.md --thinking off --temperature 0.9 --top-p 0.95
./apps/cli/bin/a4n run-step setting --input-file setting-input.json --config-file generation.json
```

`run-step` supports `caption`, `creative`, `outline`, `setting`, and `beat` (chapter 1). It requires the installed full monorepo and a configured live provider, starts a local server worker, and needs no running HTTP server. It does not create or update a work. Choose exactly one of `--seed-file` and `--input-file`; downstream steps need JSON with `seed` and the required upstream `content`. A custom SP replaces only the system prompt; omitting it uses the production prompt. `--top-k` is explicitly unsupported.

Success returns schema-validated `content` and safe `telemetry` as JSON; failures write a JSON error to stderr and exit 1. Raw model output and reasoning are not returned. The worker's default total deadline is 920 seconds, overridable with `--timeout-ms` or `A4N_CLI_TIMEOUT_MS`. See [single-step inputs, limits, and output](./docs/wiki/014-agent-cli-telemetry.md#单节点实验-run-step).

Agents opening this repo get the full recipe via the bundled skill `.claude/skills/agent4novel-drive`.

## How it works

<p align="center">
  <img src="./docs/assets/pipeline.en.svg" alt="Current five-step pipeline through first-chapter Beat approval; prose #22 and chapter continuation #6 remain planned" width="960">
</p>
<p align="center"><sub>Fig. 1 · Current five-step chain ends at beat-approved; dashed steps are future prose and chapter continuation</sub></p>

The internal caption interprets the source material, makes story-development judgments, and proposes concrete plot ideas, distinguishing source content from inferences and suggestions. It is auto-approved. Select a creative direction, approve the outline and setting, then edit or regenerate the first chapter’s Beat and approve it. The endpoint is `beat-approved`; approval does not generate prose or later chapters.

A Beat contains a title, goal, ordered writing-plan cards, and ending. Pending edits and regeneration instructions stay in page memory; leaving asks before discarding them. Whole-plan regeneration consumes those edits and instructions, creating a new pending version. Approval stores the final content on the same ID/version and makes it read-only. Version comparison (#20) and post-approval chapter regeneration (#21) remain separate work.

Edits to a pending setting live only in page memory: refreshing or leaving discards unsubmitted changes. Clicking **Approve** stores the edited content and approves the same artifact ID and version in one operation—there is no separate save-draft step or approval v2. The approved setting is read-only and remains the work's fixed reference; later changes and extensions belong to #17.

## Architecture

The architecture is built around **human-in-the-loop**: machines generate, authors judge, and author-facing artifacts must pass their review gates before the next step consumes them. The internal caption is the auto-approved preprocessing exception.

<p align="center">
  <img src="./docs/assets/workflow.en.svg" alt="Pipeline drives five steps through first-chapter Beat. Store atomically finalizes author-approved content; SQLite #9 remains planned" width="760">
</p>
<p align="center"><sub>Fig. 2 · Pipeline controls five steps; Store atomically finalizes Setting and Beat. Prose and SQLite remain future work</sub></p>

- **The orchestrator (Pipeline)** drives caption → creative → outline → setting → beat#1 in a fixed order and enforces gates with a state machine (ready → awaiting-approval → complete, derived from artifact status). Caption is auto-approved; creative, outline, setting, and Beat wait for the author's explicit action. Pipeline coordinates progression, while Store's conditional writes protect the committed artifacts.
- **Steps** are contract-bound AI generations: `runStep` zod-validates both input and output, and prompts live in SKILL.md files so prompt iteration never touches code. A step doesn't know where it sits in the pipeline, which makes it independently testable and replaceable.
- **Artifacts** are grouped by "work + kind + chapter" (`{kind, chapter?, version, content, humanStatus}`). Existing creative and outline save operations append versions; Setting and Beat approval instead replace content and status atomically on the same ID and version. The public API returns only the latest artifact in each group, not arbitrary historical versions.
- **Swappable points**: the Pipeline's dependency seams are storage (in-memory out of the box ↔ SQLite persistence in #9) and Step (`FakeStep` ↔ `RealStep`). Inside `RealStep`, `ModelRuntime` owns provider routing, credentials, base URLs, and request timeout. Switching between registered providers changes only the provider-qualified model ID; adding a provider still requires its adapter, registry entry, and key contract. Tests use fake models or mocked provider transport; executable CLI integration uses a loopback test server, never a remote model.

## Stack

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white" alt="Hono">
  <img src="https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/zod-3E67B1?logo=zod&logoColor=white" alt="zod">
  <img src="https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white" alt="Vitest">
</p>

<p align="center">Vercel AI SDK v7 (<code>@ai-sdk/deepseek</code> + <code>@ai-sdk/openai-compatible</code>) · pnpm workspaces · TypeScript end-to-end</p>

```bash
pnpm test        # unit and integration tests (no remote model calls)
pnpm typecheck
pnpm build
```

## Docs

The docs in this repo are written for agents first — and read fine by humans:

| Doc | Owns |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | Domain glossary (read it first) |
| [docs/schema.md](./docs/schema.md) | Data model, the single source of truth |
| [Contract governance](./docs/agents/contract-governance.md) | Ownership of executable contracts, domain models, and per-ticket decisions |
| [docs/adr/](./docs/adr/) | Irreversible decisions (orchestration, storage, skill files) |
| [docs/wiki/](./docs/wiki/) | Per-ticket engineering context: design intent, code landing, and reasons for change |
| [Ticket completion checklist](./docs/agents/ticket-completion-checklist.md) | Mandatory review, documentation, direct-push or PR/merge, and GitHub verification gate for every ticket |
| [docs/research/](./docs/research/) | Selection research (stack, LLM provider strategy) |
| [docs/handoff.md](./docs/handoff.md) | Session handoff snapshot (where we are, what's next) |

## Development process

Every ticket runs the same loop: grill and align scope → establish its Wiki context → plan → implement with TDD → run local gates → update knowledge → run three self-calibration passes → run Standards/Spec review → deliver by direct push or PR/merge → verify remotely. The [Ticket completion checklist](./docs/agents/ticket-completion-checklist.md) is the mandatory, single source of truth for that gate; the [Wiki contract](./docs/wiki/README.md) defines the per-ticket evidence format.

## Roadmap

| Ticket | What | Status |
|---|---|---|
| [#2](https://github.com/12bitsD/agent4novel/issues/2) | Scaffold + storage + pipeline skeleton + bookcase | ✅ |
| [#3](https://github.com/12bitsD/agent4novel/issues/3) | Unified entry + workspace idea state (manual chain) | ✅ |
| [#10](https://github.com/12bitsD/agent4novel/issues/10) | Preprocess RealStep + interview + outline/setting shapes | ✅ |
| [#11](https://github.com/12bitsD/agent4novel/issues/11) | Preprocess rework: caption + creative direction packs + compare view | ✅ |
| [#4](https://github.com/12bitsD/agent4novel/issues/4) | Outline: arcs + segments (two-level, chapter-free) | ✅ |
| [#14](https://github.com/12bitsD/agent4novel/issues/14) | Agent CLI + LLM telemetry + project driving skill | ✅ |
| [#16](https://github.com/12bitsD/agent4novel/issues/16) | Configurable ModelRuntime + LongCat provider | ✅ |
| [#13](https://github.com/12bitsD/agent4novel/issues/13) | Full setting after outline approval; edit locally and approve once ([engineering context](./docs/wiki/013-setting-generation-review.md)) | ✅ implemented |
| [#5](https://github.com/12bitsD/agent4novel/issues/5) | First-chapter Beat: edit, regenerate, approve ([context](./docs/wiki/005-beat-generation-review.md)) | Implemented; delivery in progress |
| [#22](https://github.com/12bitsD/agent4novel/issues/22) | First-chapter prose and author gate | Planned |
| [#9](https://github.com/12bitsD/agent4novel/issues/9) | SQLite after artifact design/consolidation | Planned |
| [#6](https://github.com/12bitsD/agent4novel/issues/6) | Continue writing + work detail + router | |
| [#7](https://github.com/12bitsD/agent4novel/issues/7) | Agent configuration (style / genre / payoffs) | |
| [#8](https://github.com/12bitsD/agent4novel/issues/8) | Bad-example collection | |

[Contract consolidation #19](https://github.com/12bitsD/agent4novel/issues/19) follows Beat and prose design: #5 → #22 → #19 → #9 → #6. This is scheduling, not a new dependency edge. [Post-approval setting changes #17](https://github.com/12bitsD/agent4novel/issues/17) and [conflict clarification #18](https://github.com/12bitsD/agent4novel/issues/18) remain separate follow-up work; the [#13 design](./docs/wiki/013-setting-generation-review.md) records the scope. These are planned capabilities, not current UI or storage behavior.

---

<p align="center">
  <sub><a href="./LICENSE">MIT License</a></sub><br>
  <sub>If this project speaks to you, a star or an issue is always welcome.</sub>
</p>
