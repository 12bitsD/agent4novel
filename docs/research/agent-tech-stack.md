# Agent Tech Stack — Research Notes (decision support)

> **Scope**: mainstream agent-building tech stack for a local-first, single-user web app that authors a ~500k-char Chinese web novel (网文) chapter by chapter. Architecture already fixed: "workflow skeleton + agentic steps" — 统一入口 → 预处理 → 卖点+梗概 → 大纲 → 章纲 → 正文, with human review gates between steps; each step ≈ "web search + a system prompt".
> **Method**: every claim below was checked against a primary source (official docs, repo README/source, spec, first-party API) fetched on 2026-08-22. URLs are inline. Claims I could not verify from a primary source are marked "unverified — do not rely".
> **Audience**: this is decision-support for `/to-spec` → ADRs, not an essay.

---

## Recommendation (TL;DR)

1. **Orchestration (Q1)**: use **Vercel AI SDK v7 as the model/prompt/tool layer + a thin DIY workflow skeleton in plain TypeScript** (one function per step, persisted artifacts in SQLite, human gate = app-level "approve/reject before next step"). Do **not** adopt LangGraph / CrewAI / Mastra / OpenAI Agents SDK as the orchestration layer for this app. If the team insists on a batteries-included framework instead of the thin skeleton, the closest mainstream fit is **Mastra** (TypeScript, first-class workflows + `suspend()/resume()` human-in-the-loop, skills, model routing). *Tradeoff:* the thin skeleton means you own step-runner/retry/resume logic — small for 6 linear steps with human gates; frameworks buy durable HITL pause/resume but add abstraction, and the best-fit ones (LangGraph) are Python-first, which splits the codebase.
2. **Web app (Q2)**: **Vite + React SPA + a thin Node backend** in the same TypeScript repo. Not Next.js — it's a React "full-stack" framework whose server features (SSR/routes) this app doesn't need, since the agent backend is a separate local process; Tauri later wraps any web stack unchanged.
3. **Storage (Q3)**: **SQLite as a single local file** (embedded, in-process) via **better-sqlite3**, with the six artifact kinds (卖点/梗概/大纲/章纲/正文/设定) as tables with versioned text columns; **prompts/skills as plain files on disk** following the [Agent Skills spec](https://agentskills.io/specification) (they are config, not data). Drizzle ORM optional if a typed query layer is wanted.
4. **Provider routing + prompt/skill management (Q4)**: provider keys in env vars, per-step model overrides; per-step "system prompt + skills" as files in the Agent Skills `SKILL.md` format, loaded by a tiny resolver (the app's 坏例/AI味 iteration loop becomes: edit skill files → re-run a step against the 坏例 corpus).

---

## Q1 — Agent orchestration / harness frameworks (as of 2026)

### Evaluation matrix (evidence in subsections below)

| Framework | Runtime | HITL gate support | Fixed-workflow fit | Swappable prompts/skills | Maturity (live 2026-08-21/22) | License |
|---|---|---|---|---|---|---|
| LangGraph | Python (LangGraph.js: TS) | `interrupt()` pause/resume w/ checkpointing — designed for this | Strong but low-level (you write the graph + state) | Prompts/models are ordinary code; no skill registry | ~40k stars, MIT, very active | MIT |
| CrewAI | Python | `@human_feedback` (local, console) — webhook HITL is **Enterprise-only** | Crews+Flows abstractions; opinionated | `Skills` = SKILL.md packages | ~57k stars, MIT, v1.15.17 | MIT |
| Mastra | TypeScript | `suspend()/resume()` with payload, built-in | Workflows = structured steps, exactly this shape | `skills` per agent (Agent Skills spec) + workspace skills | ~27k stars, v1.60.0, Apache-2.0 + `ee/` dir | Apache-2.0 (with separate ee/) |
| Vercel AI SDK v7 | TypeScript | Tool-level approvals (`user-approval`); step-level gates are app code | Workflow Patterns (sequential/parallel/etc.) = plain TS; no durable runner | System prompts per call; provider registry; skill uploads | ~26k stars, Apache-2.0, v7 latest | Apache-2.0 |
| OpenAI Agents SDK | Python (JS port exists) | `needs_approval` on tools → interruptions → approve/reject/resume | "Python-first": you orchestrate in plain code (agents/handoffs) | `instructions` per Agent in code; **no skills primitive found** in docs | ~29k stars, MIT, v0.22.0 | MIT |
| Pydantic AI (context) | Python | no first-class HITL primitive in docs I read | graphs + agents, typed | Capabilities + agent-spec config files | ~19k stars, MIT, v2.33.0 | MIT |
| Claude Agent SDK (context) | TS + Python | approvals/user-input handling in sessions | code-orchestrated loop | **Skills = SKILL.md files, filesystem-discovered** | first-party (Anthropic) | — |
| Plain DIY | your stack | your code | trivially | trivially (files) | n/a | n/a |

### LangGraph

- Repo self-describes as a "low-level orchestration framework for building stateful agents", positioned for "long-running, stateful agents", with "Durable execution" (persist through failures, resume where you left off), "Human-in-the-loop", "Comprehensive memory", "Production-ready deployment" — [README, langchain-ai/langgraph](https://github.com/langchain-ai/langgraph).
- Official interrupts doc: "Interrupts allow you to pause graph execution at specific points and wait for external input before continuing. This enables human-in-the-loop patterns … When an interrupt is triggered, LangGraph saves the graph state using its persistence layer and waits indefinitely until you resume execution" — [Interrupts, LangGraph docs](https://docs.langchain.com/oss/python/langgraph/interrupts). This is exactly a review-gate primitive: pause, show payload to the human, resume with `Command(resume=...)`, state persisted under a `thread_id`.
- JS/TS: "For an equivalent JS/TS library, check out LangGraph.js" — [README](https://github.com/langchain-ai/langgraph); LangGraph.js is a separate, much smaller project (~3.2k stars, MIT, active).
- Maturity: ~40k stars, MIT, latest release `sdk==0.4.3` (2026-08), repo pushed 2026-08-20 — [GitHub API repo/releases](https://api.github.com/repos/langchain-ai/langgraph).
- Fit assessment: the HITL/durability story is the strongest of the Python frameworks, but it is Python-first; using it means running a Python service beside a TS web app, and "low-level" means you write graph/state plumbing yourself. Prompts and model choice are plain code inside nodes (see node example in the interrupts doc above); LangGraph documents no prompt/skill registry — swapping prompts = editing code.

### CrewAI

- HITL guide: two approaches — "Flow-based (@human_feedback decorator)" for "local development, console-based review, synchronous workflows" (Flows, 1.8.0+), and "Webhook-based (Enterprise)" for "production deployments, async workflows" — [Human-in-the-Loop (HITL) Workflows, CrewAI docs](https://docs.crewai.com/en/learn/human-in-the-loop). The webhook (async, server-integrated) path being Enterprise-gated is a real constraint for an open-source local app.
- Flows = structured orchestration primitive: `@start`/`@listen` decorated methods, shared `Flow` state, `kickoff()` returns final output — [Flows, CrewAI docs](https://docs.crewai.com/en/concepts/flows).
- Skills: "Filesystem-based skill packages that inject domain expertise and instructions into agent prompts … Each skill is defined by a SKILL.md file with YAML frontmatter and a markdown body" — [Skills, CrewAI docs](https://docs.crewai.com/en/concepts/skills).
- LLM config: "CrewAI integrates with multiple LLM providers through providers native sdks" — [LLMs, CrewAI docs](https://docs.crewai.com/en/concepts/llms).
- Maturity: ~57k stars, MIT, v1.15.17 (2026-08) — [GitHub API](https://api.github.com/repos/crewAIInc/crewAI).
- Fit assessment: feature-rich and popular, but Python-only, opinionated (agents/crews/tasks role-play model), and its most production-appropriate HITL path is Enterprise-only.

### Mastra

- Workflows: "let you define complex sequences of tasks using clear, structured steps rather than relying on the reasoning of a single agent … fine-grained control over how data flows and transforms between steps" — built from `createStep` (with `inputSchema`/`outputSchema`) composed with `createWorkflow` — [Workflows, Mastra docs](https://mastra.ai/docs/workflows/overview).
- HITL: "Some workflows need to pause for human input before continuing … works well for manual approvals, rejections, gated decisions" — `suspend()` returns a payload ("reason") and the workflow later resumes with `resumeData` — [Human-in-the-Loop, Mastra docs](https://mastra.ai/docs/workflows/human-in-the-loop). Repo README: "Suspend an agent or workflow and await user input or approval before resuming. Mastra uses storage to remember execution state, so you can pause indefinitely and resume where you left off" — [README, mastra-ai/mastra](https://github.com/mastra-ai/mastra).
- Agents compose into workflows ("Use agents directly or compose them into workflows or multi-agent systems") — [Agents, Mastra docs](https://mastra.ai/docs/agents/overview).
- Skills: "Skills are reusable instructions that teach agents how to perform specific tasks. They follow the Agent Skills specification" — attach via agent `skills` config or filesystem workspaces — [Agent skills, Mastra docs](https://mastra.ai/docs/skills).
- Model routing: "unified interface … 6759 models from 180 providers through a single API"; model specified as `"provider/model-name"`, e.g. `"openai/gpt-5.6-sol"`; reads per-provider env keys; per-task model mixing — [Model Providers, Mastra docs](https://mastra.ai/models).
- License: Apache-2.0 with an `ee/` directory (enterprise features) under a separate license — [LICENSE.md, mastra-ai/mastra](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md).
- Maturity: ~27k stars, `@mastra/core@1.60.0` (2026-08), repo pushed 2026-08-21 — [GitHub API](https://api.github.com/repos/mastra-ai/mastra).
- Fit assessment: the closest mainstream one-framework match to "fixed workflow + human gates + per-step agents" **in TypeScript**. Tradeoffs: young and fast-moving API (v1.x with frequent breaking changes), the `ee/` license split means double-checking which features are free, and it's a bigger abstraction surface than the app needs.

### Vercel AI SDK (v7)

- "The AI SDK is the TypeScript toolkit designed to help developers build AI-powered applications and agents with React, Next.js, Vue, Svelte, Node.js, and more … standardizes integrating artificial intelligence (AI) models across supported providers" — [Introduction, AI SDK docs](https://ai-sdk.dev/docs/introduction).
- Agents: `ToolLoopAgent` + "Workflow Patterns": Sequential Processing (chains), Parallel Processing, Evaluation/Feedback Loops, Orchestration (orchestrator-worker), Routing; guidance "Start with the simplest approach that meets your needs" — [Workflow Patterns, AI SDK docs](https://ai-sdk.dev/docs/agents/workflows). The doc notes these patterns are "adapted from Anthropic's guide on building effective agents".
- Tool Approvals: "Use `toolApproval` on `ToolLoopAgent` to review, approve, or deny selected tool calls before they execute"; statuses include `'user-approval'`: "emit an approval request and wait for an explicit response" — [Tool Approvals, AI SDK docs](https://ai-sdk.dev/docs/agents/tool-approvals). Note this gates *tool calls*; whole-step gates are your app code.
- Durable agents: `WorkflowAgent` from `@ai-sdk/workflow` adds "automatic state persistence … and built-in tool approval flows that survive workflow step boundaries", but "run inside a workflow" — the Vercel cloud Workflow product (Workflow 5, currently `beta`) — [WorkflowAgent, AI SDK docs](https://ai-sdk.dev/docs/agents/workflow-agent). I.e., AI SDK's durability story is cloud-bound; for a local app you persist state yourself.
- Maturity: ~26k stars, Apache-2.0 (LICENSE file), latest docs version "AI SDK 7.x (Latest)" — [GitHub repo](https://github.com/vercel/ai) / [Introduction](https://ai-sdk.dev/docs/introduction).
- Fit assessment: minimal, provider-agnostic, same TS stack as the web app; the workflow-skeleton part is deliberately plain TS (which suits a fixed pipeline), but it ships no durable step runner and no persistence — you own those (small, given human gates).

### OpenAI Agents SDK

- "The OpenAI Agents SDK enables you to build agentic AI apps in a lightweight, easy-to-use package with very few abstractions. It's a production-ready upgrade of our previous experimentation for agents, Swarm." Primitives: Agents, Handoffs, Guardrails. "Python-first: Use built-in language features to orchestrate and chain agents, rather than needing to learn new abstractions." Features include "Human in the loop: Built-in mechanisms for involving humans during agent runs" — [OpenAI Agents SDK docs](https://openai.github.io/openai-agents-python/).
- HITL: tools declare `needs_approval`; the run pauses and surfaces `interruptions`; serialize the run to a `RunState`, then `state.approve(...)`/`state.reject(...)` and resume — [human_in_the_loop.md, openai/openai-agents-python](https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md).
- Model config: default provider = OpenAI (Responses API); model strings per agent; `OPENAI_DEFAULT_MODEL` env var; per-run `RunConfig(model=...)`; third-party adapters exist for non-OpenAI providers — [models/index.md](https://github.com/openai/openai-agents-python/blob/main/docs/models/index.md), [config.md](https://github.com/openai/openai-agents-python/blob/main/docs/config.md).
- Skills: **no first-class "skills" feature documented** in the SDK docs as of this writing; the only `skills` paths in the repo are the project's own internal dev-agent skills (`.agents/skills/...`), not a user-facing API — [repo tree](https://github.com/openai/openai-agents-python). Prompt/behavior swapping is done by passing `instructions` per `Agent` in code.
- Maturity: ~29k stars, MIT, v0.22.0 (2026-08) — [GitHub API](https://api.github.com/repos/openai/openai-agents-python).
- Fit assessment: philosophy ("few primitives, orchestrate in plain code") aligns with the thin-skeleton idea, but Python-first, OpenAI-centric defaults, and no skill primitive.

### Pydantic AI / Claude Agent SDK (context, mainstream in 2025–26)

- Pydantic AI: `Agent` = instructions/system prompt + tools + typed deps + output type; "Capabilities — reusable bundles of tools, hooks, instructions, and model settings" and agents "load from configuration files" via agent-spec — [Agents, Pydantic AI docs](https://github.com/pydantic/pydantic-ai/blob/main/docs/agent.md). Python; ~19k stars, MIT, v2.33.0 — [GitHub API](https://api.github.com/repos/pydantic/pydantic-ai). Included for completeness; not recommended here (Python, no first-class HITL gate primitive in the docs I read — unverified claim if you rely on it).
- Claude Agent SDK: first-party Anthropic SDK (TS + Python) wrapping the Claude Code agent loop; "Extend agents with skills": skills are "SKILL.md files containing instructions, descriptions, and optional supporting resources", filesystem-discovered, model-invoked or user-invoked, scoped via a `skills` option — [Extend agents with skills, Claude Code docs](https://docs.claude.com/en/api/agent-sdk/skills), [Agent SDK overview](https://docs.claude.com/en/api/agent-sdk/overview). It's Claude-centric (Anthropic models), so it doesn't fit "swap providers freely", but it is the origin of the mainstream skills pattern.

### Plain DIY — what the primary sources actually say

- Anthropic (first-party): "we recommend finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all … workflows offer predictability and consistency for well-defined tasks, whereas agents are the better option when flexibility and model-driven decision-making are needed at scale" — [Building Effective Agents, Anthropic](https://www.anthropic.com/research/building-effective-agents). The fixed 统一入口→正文 pipeline is exactly the "workflow" case.
- OpenAI: use the bare Responses API "when you want to own the loop, tool dispatch, and state handling yourself; your workflow is short-lived and mainly about returning the model's response" — [Agents SDK or Responses API?, openai-agents-python](https://openai.github.io/openai-agents-python/). The same logic transfers to a thin DIY loop over any provider SDK.
- Vercel AI SDK: "Start with the simplest approach that meets your needs" — [Workflow Patterns](https://ai-sdk.dev/docs/agents/workflows).

### Q1 verdict

For "fixed 6-step pipeline + human gates + swappable per-step prompts/skills, in a TS local app": a **thin DIY skeleton on Vercel AI SDK v7** gives the least abstraction, one TS codebase end-to-end, provider-agnostic calls, tool-level approval when needed, and trivial prompt/skill swapping (files). The cost you pay vs. a framework: no durable pause/resume runner and no graph engine — but the human review gates already impose a natural persistence boundary (step output → SQLite → human approves → next step), so "durability" is largely free. **If you prefer a framework to own this**, Mastra is the one whose primitives (workflow steps + `suspend()/resume()` + skills + model routing) map 1:1 to the architecture; accept a young, fast-moving API and the `ee/` license split. LangGraph is the right answer only if the backend were Python.

---

## Q2 — Web app stack for a local-first single-user app

- **Vite**: dev server with "extremely fast Hot Module Replacement (HMR)" + a "build command that bundles your code with Rolldown, pre-configured to output highly optimized static assets for production"; framework-agnostic via plugins — [Vite guide](https://vite.dev/guide/). A Vite SPA is just static assets + a dev server: it runs locally trivially.
- **React**: "If you want to build a new app or website with React, we recommend starting with a framework" — the recommended full-stack frameworks (Next.js, React Router v7, Expo, TanStack Start, Redwood) "do not require a server. All the frameworks on this page support client-side rendering (CSR), single-page apps (SPA), and static-site generation (SSG)" — [Start a New React Project, react.dev](https://react.dev/learn/start-a-new-react-project). I.e., even React's official line lets you run client-only; the framework recommendation is about scaling/deployment, not about local single-user apps.
- **Next.js**: "a React framework for building full-stack web applications … automatically configures lower-level tools like bundlers and compilers" — [Next.js docs](https://nextjs.org/docs). It *can* self-host: "self-host your Next.js application on a Node.js server, Docker image, or static HTML files (static exports)" — [Self-Hosting, Next.js docs](https://nextjs.org/docs/app/guides/self-hosting). But its value (SSR, routing, server components) targets server-rendered full-stack apps; for this app the "backend" is an agent runner process, not Next.js routes, so Next adds a second server framework without buying anything.
- **Tauri (later wrap)**: "Create small, fast, secure, cross-platform applications … Bring your existing web stack to Tauri … Tauri supports any frontend framework so you don't need to change your stack"; frontend in JS, logic in Rust; "Minimal Size … little as 600KB" — [tauri.app](https://tauri.app/). So Vite+React built today wraps into Tauri without a rewrite.
- **Node backend**: AI SDK (the chosen orchestration layer) explicitly targets "Node.js" as a supported runtime — [Introduction, AI SDK](https://ai-sdk.dev/docs/introduction).

**Recommendation**: one TS repo: `apps/web` = Vite + React SPA (bookcase 书架, creation page, review gates), `apps/server` = thin Node HTTP server (Express/Hono-class) exposing JSON endpoints; both talk to the same step-runner module. Skip Next.js unless SSR/route features are wanted later; local-first + open source + possible Tauri wrap all favor the simpler Vite SPA.

---

## Q3 — Storage for structured creative artifacts

- **SQLite (primary source)**: "an in-process library that implements a self-contained, serverless, zero-configuration, transactional SQL database engine … SQLite is the most widely deployed database in the world … an embedded SQL database engine. Unlike most other SQL databases, SQLite does not have a separate server process. SQLite reads and writes directly to ordinary disk files. A complete SQL database with multiple tables, indices, triggers, and views, is contained in a single disk file … Think of SQLite not as a replacement for Oracle but as a replacement for fopen()" — [About SQLite](https://www.sqlite.org/about.html). Zero-configuration + single file = exactly a local single-user app.
- **Node binding**: better-sqlite3 — "The fastest and simplest library for SQLite in Node.js", "Full transaction support", "Easy-to-use synchronous API" — [README, WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3).
- **Optional typed layer**: Drizzle ORM supports SQLite among its databases ("PostgreSQL MySQL SQLite SingleStore MSSQL CockroachDB") — [orm.drizzle.team](https://orm.drizzle.team/).
- **What should stay as files, not DB rows**: prompts/skills are config-as-code and are versioned/edited like code — the Agent Skills spec models them as files (`SKILL.md` + `references/`, `scripts/`, `assets/`) — [Specification, agentskills.io](https://agentskills.io/specification). 坏例 as a file (e.g. JSONL) is also fine; the point is skills/prompts are not "creative artifacts".

**Recommendation**: single SQLite DB file (schema: `works` 作品, plus per-artifact tables 脑洞/卖点/梗概/大纲/章纲/正文/设定 with `version`/`created_at`/`human_status` columns for the review gates), accessed via better-sqlite3; skills/prompts live in the repo as SKILL.md files (see Q4). This is the mainstream lightweight choice per the SQLite "replacement for fopen()" framing; no client/server DB needed for one local user.

---

## Q4 — LLM provider/model routing + "system prompt / skill" management

**How mainstream tools structure swappable prompts/skills and provider config:**

- **AI SDK v7**: system prompts are per-call values (`system`/`prompt` in `generateText`/`streamText`), swappable by design — [Prompts, AI SDK docs](https://ai-sdk.dev/docs/foundations/prompts). Provider management: `customProvider` (pre-configure model settings, name aliases, limit available models) and `providerRegistry` ("mix multiple providers and access them through simple string ids") — [Provider & Model Management, AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/provider-management). Skill uploads: `uploadSkill()` uploads a SKILL.md bundle to a provider and returns a `ProviderReference` — [Skill Uploads, AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/skill-uploads).
- **Mastra**: model = `"provider/model-name"` string per agent; env-var API keys; "Mix and match models … use different models for different tasks" — [Model Providers, Mastra docs](https://mastra.ai/models). Skills attached per agent in code or discovered from filesystem workspaces, following the Agent Skills spec — [Agent skills, Mastra docs](https://mastra.ai/docs/skills).
- **CrewAI**: providers via their native SDKs, configurable per agent — [LLMs, CrewAI docs](https://docs.crewai.com/en/concepts/llms); skills as SKILL.md packages — [Skills, CrewAI docs](https://docs.crewai.com/en/concepts/skills).
- **OpenAI Agents SDK**: per-agent `instructions`; model strings + `OPENAI_API_KEY`/`OPENAI_DEFAULT_MODEL` env defaults; `set_default_openai_key()`/`set_default_openai_client()` for custom endpoints; third-party adapters for non-OpenAI providers — [config.md](https://github.com/openai/openai-agents-python/blob/main/docs/config.md), [models/index.md](https://github.com/openai/openai-agents-python/blob/main/docs/models/index.md). No skills primitive documented (see Q1).
- **Claude Agent SDK**: skills as SKILL.md files, filesystem-discovered, model-invoked or user-invoked — [Extend agents with skills, Claude Code docs](https://docs.claude.com/en/api/agent-sdk/skills).
- **The cross-tool format**: the Agent Skills specification — a skill is a directory with a required `SKILL.md` (YAML frontmatter: `name`, `description`, optional `license`/`compatibility`/`metadata`/`allowed-tools`; markdown body with "progressive disclosure" and file references) — [Specification, agentskills.io](https://agentskills.io/specification). Mastra and CrewAI already consume this format; it is the de-facto portable way to author per-step "skills" that survive framework changes.

**Recommendation**: per-step agent = `{ id, model (provider/model string), systemPrompt, skills: SKILL.md paths, tools: [webSearch, ...] }` declared in one TS config module (easy to edit/test per step, matching the product's "Agent 配置 → 可扩展为上传的 skill / prompt" concept in `CONTEXT.md`). Store skill bodies as files in the repo following the Agent Skills spec; provider API keys in env vars with per-step model override. This is exactly how AI SDK/Mastra structure it (string model ids + file skills), and it keeps the 坏例/AI味 iteration loop simple: edit a step's SKILL.md → re-run that step against the 坏例 corpus.

---

## Unverified / caveats (be explicit before relying)

- **OpenAI Agents SDK "no skills primitive"** is a negative claim based on absence in the current docs/repo tree I inspected; if OpenAI ships skills later, re-check — I found no primary doc describing it as of 2026-08-22.
- **Pydantic AI HITL**: I verified its Agent model (instructions/capabilities/agent-spec) but did not verify a first-class human-gate primitive in Pydantic AI docs; treat that side of the Pydantic row as unverified.
- **Vercel AI SDK durability**: `WorkflowAgent` ties to the Vercel cloud Workflow product (Workflow 5, `beta`); the exact GA/on-prem status of Vercel Workflow was not verified from a primary source.
- **Version numbers/star counts** are point-in-time (fetched 2026-08-22 via GitHub API and live docs); they support the "actively maintained" claim, not a promise.
- **CrewAI webhook HITL is Enterprise-only** — verified from the HITL doc's table ("Webhook-based (Enterprise)"), but the exact commercial terms/pricing of "Enterprise" were not verified from a primary source.
