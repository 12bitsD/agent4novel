# agent4novel

> A local-first, single-user, open-source writing agent for Chinese web novels: you steer the story, it fills the gaps — turning a rough idea into a ~500k-character serial, gate by gate.

[中文](./README.md) · [MIT License](./LICENSE) · [Docs](#docs)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## The problem

You have the idea but not the craft: can't flesh out worldbuilding, can't structure a book-length outline, prose is shaky — so the idea stays an idea. agent4novel turns "writing a novel" into a fixed pipeline: preprocess → hooks+synopsis → outline → (chapter-beat → prose) × N. The author does exactly two things: **steer the story** and **pass judgment at each gate**. The agent fills everything in between.

## Pipeline

```
Unified entry (one-line idea / uploaded setting doc)
  → Preprocess (classify input stage + reverse-interview to fill gaps
      → JSON of hooks / synopsis / setting / outline points)
  → Outline (whole-book chapter skeleton, one line per chapter)
  → ┌────────────── per chapter ──────────────┐
    Beat (goal / scenes / conflict / end hook) ── Beat gate: you review direction
    Prose (~2000–4000 chars) ─────────────────── Prose gate: you review the text
    └────────────────────────────────────────────┘
  → Finished book
```

Gates are hard constraints: nothing advances until the artifact passes. No approved beat, no prose.

## Quick start

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

Open <http://localhost:5173>. **No API key needed to try it**: without one it runs in demo mode (a built-in fake generates sample content, no real model calls).

With a real model:

```bash
export DEEPSEEK_API_KEY=sk-...   # read by the provider registry; code never touches the key
pnpm dev
```

## Architecture

In one sentence: **a workflow skeleton with an agent inside each step**. The skeleton is a fixed pipeline (order, gates, artifacts are determined); inside each step lives agent capability (LLM + prompt/skill files). The contract between them: the workflow declares each step's input and output (zod-validated), and the step only generates.

- **Steps are position-agnostic**: a step doesn't know where it sits in the pipeline; its output is a single `{content}` JSON blob. Parsing, assembly and persistence all belong to the pipeline.
- **Two seams**: storage (`InMemoryStore` ↔ `SQLiteStore` in #9) and steps (`FakeStep` ↔ `RealStep`) — tests always run fakes, never the network.
- **The Pipeline is a deep module**: all gate logic (`gateAfter` marks output pending until approved / `gateBefore` requires an approved upstream) lives in exactly one place.
- **Five artifact kinds**: `preprocess` (point-lists JSON) → `outline` → `setting` → `beat` → `prose`; the first three are per-work, the last two per work × chapter. Artifacts are fully versioned (`appendArtifact`); human saves are auto-approved, agent output awaits review.
- **Interview**: preprocessing asks the author a batch of questions before normalizing; the Q&A state is transient in-memory (accepted loss on restart, persisted in #9).

## Stack

pnpm workspaces · TypeScript end-to-end · Vite + React (web) · Hono (server) · zod · Vitest · Vercel AI SDK v7 + `@ai-sdk/deepseek` (`createProviderRegistry`: switching provider = changing a string prefix, invisible upstream).

```bash
pnpm test        # all unit tests (always faked, never networked)
pnpm typecheck
pnpm build
```

## Docs

Documentation in this repo is a first-class, agent-consumable citizen:

| Doc | Owns |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | Domain glossary (read it first) |
| [docs/schema.md](./docs/schema.md) | Data model, single source of truth |
| [docs/adr/](./docs/adr/) | Irreversible decisions (orchestration, storage, skill files) |
| [docs/wiki/](./docs/wiki/) | Per-ticket tech plans + status logs (the only source of HOW) |
| [docs/research/](./docs/research/) | Selection research (tech stack, LLM provider strategy) |
| [docs/handoff.md](./docs/handoff.md) | Session handoff snapshot (current state & next step) |

## Development process

Every ticket runs the same loop: grill-to-align → wiki tech plan → TDD red/green slices → 3 self-calibration rounds → two-axis code review. See [docs/wiki/README.md](./docs/wiki/README.md).

## Roadmap

- [x] [#2](https://github.com/12bitsD/agent4novel/issues/2) Scaffold + storage + pipeline skeleton + bookcase
- [x] [#3](https://github.com/12bitsD/agent4novel/issues/3) Unified entry + workspace idea state (manual chain)
- [x] [#10](https://github.com/12bitsD/agent4novel/issues/10) Preprocess RealStep + interview + outline/setting shape finalization
- [ ] [#4](https://github.com/12bitsD/agent4novel/issues/4) Outline generation
- [ ] [#5](https://github.com/12bitsD/agent4novel/issues/5) Beat/prose gates
- [ ] [#6](https://github.com/12bitsD/agent4novel/issues/6) Continue writing + work detail + router
- [ ] [#7](https://github.com/12bitsD/agent4novel/issues/7) Agent configuration (style / genre / payoffs)
- [ ] [#8](https://github.com/12bitsD/agent4novel/issues/8) Bad-example collection
- [ ] [#9](https://github.com/12bitsD/agent4novel/issues/9) SQLite persistence

## License

[MIT](./LICENSE)
