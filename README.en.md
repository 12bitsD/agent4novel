# agent4novel

[中文](./README.md) · [MIT License](./LICENSE) · [Docs](#docs)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

agent4novel turns a web-novel idea into a finished serial. Give it a one-line idea (or an uploaded setting doc); it asks you a few key questions back, then generates ring by ring: hooks and synopsis, the book outline, each chapter's beat sheet, each chapter's prose.

It is built for authors who have ideas but no writing training: the AI does all the professional drafting, and you only make calls at the gates — approve, edit, or send back. Everything runs locally, single-user, open source; your data never leaves your machine.

## Quick start

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

Open <http://localhost:5173>. No API key needed to try it: without one, the app runs in demo mode, where a built-in fake produces sample content and no real model is called.

With a real model (DeepSeek today):

```bash
export DEEPSEEK_API_KEY=sk-...
pnpm dev
```

## How it works

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="Pipeline: unified entry → preprocess (reverse interview) → points JSON → (preprocess gate) → outline → (beat → beat gate → prose → prose gate) × N → finished book" width="960">
</p>
<p align="center"><sub>Fig. 1 · Pipeline and gates: boxes are agent steps / artifacts, red diamonds are human gates, dashes mark the per-chapter loop</sub></p>

Preprocessing confirms the story direction with you first; after that, every chapter gets a beat sheet before prose, and you review both. Nothing advances past a gate you haven't passed.

## Architecture

The whole architecture is built around one idea: **human-in-the-loop** — machines generate, humans judge, and the only channel between the two layers is a gate. Nothing the AI writes counts until it passes one.

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="Layered architecture: the judgment layer (user input, author review) on top, the generation layer (machine) below: the Pipeline orchestrator owns all flow control, with the step chain preprocess → outline → beat → prose inside it; gates between steps hand AI output (pending) to the author for approval (approved); two swappable seams at the bottom of the container (storage: InMemoryStore│SQLiteStore, step: FakeStep│RealStep); artifacts land in a versioned store" width="760">
</p>
<p align="center"><sub>Fig. 2 · Human-in-the-loop, layered: judgment (human) on top, generation (machine) below; the Pipeline owns all flow control, and gates are the only channel between the layers</sub></p>

- **The orchestrator (Pipeline)** drives the step chain in a fixed order and enforces gates with a state machine (ready → awaiting-interview / awaiting-approval → complete, derived from artifact status). AI output always lands as pending; the next step unlocks only after you approve or edit-and-save. Ordering, gating and persistence logic live in this one module.
- **Steps** are contract-bound AI generations: `runStep` zod-validates both input and output, and prompts live in SKILL.md files so prompt iteration never touches code. A step doesn't know where it sits in the pipeline, which makes it independently testable and replaceable.
- **Artifacts** are filed by "work + kind + chapter" as an append-only version chain (`{kind, chapter?, version, content, humanStatus}`); any historical version is readable. A manual edit-and-save counts as approval; agent output awaits review.
- **Swappable points**: storage (in-memory out of the box ↔ SQLite persistence in #9) and model (AI SDK `createProviderRegistry` — switching providers is a string prefix, code never touches the key) are the two injection points. Tests run the whole chain on FakeStep and never touch the network.

## Stack

TypeScript end-to-end · pnpm workspaces · Vite + React (web, :5173) · Hono (server, :8787) · zod · Vitest · Vercel AI SDK v7 (`@ai-sdk/deepseek`)

```bash
pnpm test        # unit tests (all faked, never networked)
pnpm typecheck
pnpm build
```

## Docs

The docs in this repo are written for agents first — and read fine by humans:

| Doc | Owns |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | Domain glossary (read it first) |
| [docs/schema.md](./docs/schema.md) | Data model, the single source of truth |
| [docs/adr/](./docs/adr/) | Irreversible decisions (orchestration, storage, skill files) |
| [docs/wiki/](./docs/wiki/) | Per-ticket tech plans and status logs (the only source of HOW) |
| [docs/research/](./docs/research/) | Selection research (stack, LLM provider strategy) |
| [docs/handoff.md](./docs/handoff.md) | Session handoff snapshot (where we are, what's next) |

## Development process

Every ticket runs the same loop: grill-to-align → wiki tech plan → TDD red/green slices → three self-calibration rounds → two-axis code review. See [docs/wiki/README.md](./docs/wiki/README.md).

## Roadmap

- [x] [#2](https://github.com/12bitsD/agent4novel/issues/2) Scaffold + storage + pipeline skeleton + bookcase
- [x] [#3](https://github.com/12bitsD/agent4novel/issues/3) Unified entry + workspace idea state (manual chain)
- [x] [#10](https://github.com/12bitsD/agent4novel/issues/10) Preprocess RealStep + interview + outline/setting shapes
- [ ] [#4](https://github.com/12bitsD/agent4novel/issues/4) Outline generation
- [ ] [#5](https://github.com/12bitsD/agent4novel/issues/5) Beat/prose gates
- [ ] [#6](https://github.com/12bitsD/agent4novel/issues/6) Continue writing + work detail + router
- [ ] [#7](https://github.com/12bitsD/agent4novel/issues/7) Agent configuration (style / genre / payoffs)
- [ ] [#8](https://github.com/12bitsD/agent4novel/issues/8) Bad-example collection
- [ ] [#9](https://github.com/12bitsD/agent4novel/issues/9) SQLite persistence

## License

[MIT](./LICENSE)
