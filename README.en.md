# agent4novel

[中文](./README.md) · [MIT License](./LICENSE) · [Docs](#docs)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

agent4novel is a local-first writing assistant for Chinese web novels, built for authors who have the idea but not the craft. You decide where the story goes and review every key artifact; the AI does the professional heavy lifting — filling out worldbuilding, structuring the outline, writing chapters. The goal: turn a one-line idea into a finished ~500k-character serial.

## Why

The hard part of web novels usually isn't inspiration — it's the distance between inspiration and a finished book. Worldbuilding needs filling, the outline needs structure, and every chapter has to read well. agent4novel breaks that distance into a pipeline: AI generates, humans judge.

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

Writing a book here means one pipeline plus a handful of gates:

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="Pipeline: unified entry → preprocess (reverse interview) → points JSON → (preprocess gate) → outline → (beat → beat gate → prose → prose gate) × N → finished book" width="960">
</p>
<p align="center"><sub>Fig. 1 · Pipeline and gates: boxes are agent steps / artifacts, red diamonds are human gates, dashes mark the per-chapter loop</sub></p>

The pipeline produces four kinds of content in a fixed order: preprocess points (hooks, synopsis, setting and outline directions), the book outline, a per-chapter beat sheet, and the chapter prose itself. Every artifact pauses at a gate for you: approve it as-is, or edit first. Nothing advances past a gate you haven't passed.

## What the pipeline is made of

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="Composition: a Pipeline orchestrator drives the step chain (preprocess → outline → beat → prose), artifacts land in a versioned store, the author reviews at gates; on the right, a zoomed single step: input contract → Agent (LLM + SKILL.md) → output JSON" width="960">
</p>
<p align="center"><sub>Fig. 2 · The four parts of the workflow — orchestrator, steps, artifact store, and the human at the gates; on the right, the inside of a single step</sub></p>

- **The orchestrator (Pipeline)** keeps the pipeline moving in a fixed order and enforces the gates: AI output is always marked "pending review" first, and the next step unlocks only after you approve. Ordering, gating and persistence logic live in this one module.
- **Steps** are single AI generations. A step doesn't know where it sits in the pipeline; it only honors an input/output contract (zod-validated both ways). Prompts live in SKILL.md files, so prompt iteration never touches code.
- **Artifacts** — every step's output is filed by "work + kind + chapter" and fully versioned, so you can return to any previous version. A manual edit-and-save in the UI counts as approval.
- **Two swappable points**: storage and model. Storage defaults to in-memory (zero setup), with SQLite planned for real persistence (#9); models go through the AI SDK registry, so switching providers is just a string prefix. Tests always run fake steps and never touch the network.

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
