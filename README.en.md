<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel book mark" width="64" height="64">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">AI-assisted writing for Chinese web novels · Runs locally, in your browser</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">Writing workflow</a> ·
  <a href="#docs">Docs</a> ·
  <a href="./README.md">中文</a>
</p>

Enter a story idea or import text from TXT, Markdown (`.md`), Word (`.docx`), or PDF documents. AI helps develop directions, outlines, settings and chapter prose; you edit the content, review its direction and decide when to continue.

![Chapter directory, prose reading area and editing control](./docs/assets/workspace-demo.jpg)

<p align="center"><sub>Actual interface in demo mode, shown in Chinese, with specially written example prose.</sub></p>

## Current status

**The local minimum viable product (MVP) has been delivered; development continues.** It supports:

- Starting from an idea or document, choosing a creative direction, and approving the outline and setting before writing chapters.
- Reviewing each chapter plan and prose separately, browsing chapters and editing approved historical prose.
- Configuring style, genre, payoff, models and generation parameters, with uploaded writing instructions (Prompt) and guidance files (Skill).
- Selecting saved prose, adding an optional note, and collecting bad examples with their original text and version.
- Saving works, all artifact versions, configuration, uploaded files and samples locally, with restart and backup recovery.

## Quick start

<a id="start-with-docker-recommended"></a>

### Docker (recommended)

Install Git and Docker with Compose support (such as Docker Desktop), then run:

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
docker compose up --build -d --wait
```

Open **[localhost:8787](http://localhost:8787)**. With neither a model selected nor any provider API key, the app uses built-in examples for editing and approval without calling AI. Existing keys enable real-model calls; without an explicit model, DeepSeek takes priority over LongCat.

Stop with `docker compose stop`. Check health with `docker compose ps` and startup errors with `docker compose logs app`. If the port is occupied, run `A4N_HTTP_PORT=8790 docker compose up --build -d --wait` and open that port. One service provides Web and API, accessible only from this computer.

<details>
<summary>Run from source</summary>

<a id="start-demo-mode-from-source"></a>

Use the project's pinned versions: **Node.js 24.19.0 and pnpm 12.5.1**. These commands are for macOS and Linux; if you already have the source, enter its directory directly:

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
pnpm install --frozen-lockfile
pnpm dev
```

Leave the terminal running and open **[localhost:5173](http://localhost:5173)**. The initial bookcase is empty; create a work to begin. To prepopulate samples, start with `A4N_SEED_DEMO=1 pnpm dev`; only an empty bookcase is populated.

CLI entry: `pnpm cli --help`. See [CLI documentation](./docs/wiki/014-agent-cli-telemetry.md) for work operations, isolated node tests and diagnostics.

</details>

<a id="configure-a-model-service"></a>

### Connect a real model

**DeepSeek** and **LongCat** are supported; obtain an API key from your chosen provider. Wait until prose is shown as saved, then stop Docker with `docker compose stop`, or press `Ctrl+C` in the terminal running from source. Edit an existing `.env.local` directly; for first-time setup, create a file readable and writable only by your operating-system user:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Fill in one of the following configurations in `.env.local`, leaving the other settings unchanged:

| Provider | `A4N_MODEL` | API key field |
| --- | --- | --- |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| LongCat | `longcat:LongCat-2.0` | `LONGCAT_API_KEY` |

Restart Docker with `docker compose --env-file .env.local up --build -d --wait`, or use `pnpm dev` for source runs. Selecting a model without its corresponding key causes startup to fail.

API keys are supplied at runtime, and Git ignores `.env.local`. Real-model calls send the input and story content needed for generation to the chosen service. See [model configuration](./docs/wiki/016-model-runtime-provider-config.md#配置契约) for the full options.

## How it works

The system first prepares a story brief (Caption) from your input, then follows this workflow. **Approve** means accepting content as the basis for subsequent generation.

| Stage | Generated content | Author action |
| --- | --- | --- |
| Creative direction | Two directions by default, with synopsis, characters and conflict | Compare, edit and select one |
| Outline | Whole-book plot and main conflicts | Edit and approve |
| Setting | Characters, relationships, world rules and background | Edit and approve |
| Chapter plan | This chapter's goal, content order and ending | Edit or regenerate, then approve |
| Prose | Chapter text based on its plan and setting | Edit or rewrite the chapter, then approve |

Prose approval completes the chapter. “Start next chapter” generates the next chapter plan. Use the chapter directory to revisit earlier chapters. Approved prose opens in reading mode; select “编辑” (Edit) to change it, with autosave preserving approval. Editing an earlier chapter flags existing later chapters for a continuity check while keeping their text and status.

<a id="adjust-writing-preferences"></a>

### Adjust writing configuration

Open “Agent 配置” (Agent configuration) and set style, genre and payoff. Style applies to prose; genre to creative directions and later content; payoff to creative directions, outlines, chapter plans and prose. Advanced controls provide default models/parameters and per-step overrides. You can also upload and select Prompt guidance or a `SKILL.md` with `name` and `description`, then save the configuration.

Saved changes affect the next generation; an operation in progress keeps its starting configuration, and existing content and approval remain. Uploaded files and saved configuration survive refreshes. Configure the provider as above before using a real model; demo mode still uses built-in examples.

<a id="collect-prose-examples-for-improvement"></a>

### Collect bad examples

Select saved prose in reading or editing mode, optionally add a note, then click “标记为坏例” (Mark as a bad example). Open “坏例收集” to review this chapter's samples; later rewrites do not change their original text. Before changing chapters, submit the sample or clear the selection and note.

Save prose and reconcile uncertain operations first. If the mark result is unknown, keep the page and use “核对标记结果” to check it, or “重试标记原请求” to explicitly retry the same request.

## Data and limitations

Once prose is shown as saved, it survives page refreshes and server restarts. Keep using the same data location. Docker and source runs have separate bookcases:

| Runtime | Data location | Retention and switching |
| --- | --- | --- |
| Docker | Compose's `data` volume | Container recreation retains it; use the same Compose project name and keep the volume |
| Source | Default `.data/agent4novel.sqlite`, with uploaded files also under `.data` | Set `A4N_DATA_DIR` to choose another directory; relative paths use the project root, and an empty directory shows an empty bookcase |

<a id="keep-and-back-up-your-works"></a>

**Before backup or recovery, stop all services using the data directory and preserve the entire directory, including the database and uploaded files.** Back up the current directory before restoring. See [Docker maintenance](./docs/wiki/033-local-docker-ci.md#维护操作) and [work storage and recovery](./docs/wiki/009-sqlite-persistence.md) for commands. Docker keeps its data directory in the volume; `A4N_DATA_DIR`, `A4N_HOST` and `A4N_PORT` apply to source runs. Use `A4N_HTTP_PORT` for Docker's host port.

- Unsaved prose and unsubmitted setting, chapter-plan and configuration edits remain only in the current page; refreshes or leaving after discarding edits lose them.
- Approved settings and chapter plans are read-only. Continuation mainly uses the preceding chapter; long-form setting search and a work Wiki are not yet available.
- Prompt/Skill files provide text guidance; tools, scripts and attachments are not executed. Bad examples support manual review, with no automatic analysis, scoring or rewriting.
- Restarts do not automatically resume model calls. Check saved content before continuing; diagnostic logs do not persist across restarts.
- Save or reconcile configuration before starting the next chapter if it is unsaved, saving or has an unknown result. Editing configuration during generation keeps the current page; after saving or explicitly discarding edits, use the directory to open the generated chapter. Reconcile an unknown configuration request or explicitly retry the original request.
- The app is for local single-user use, with no accounts or public-access controls. Full-novel generation quality has not been evaluated; see the [MVP verification record](./docs/wiki/001-mvp-acceptance.md#测试与验证) for engineering acceptance scope.

<a id="architecture"></a>

## Docs

This README is the user entry point. The [project Wiki](./docs/wiki/README.md) holds engineering context and verification; [Issues](https://github.com/12bitsD/agent4novel/issues) hold requirements and future work. Most engineering documentation is in Chinese.

<a id="stack"></a>
<a id="development-process"></a>
<a id="development"></a>

<details>
<summary>Engineering entry points for development and operations agents</summary>

- **Collaboration rules:** [AGENTS.md](./AGENTS.md), [completion checklist](./docs/agents/ticket-completion-checklist.md).
- **Operation and diagnostics:** [runtime skill](./.claude/skills/agent4novel-drive/SKILL.md), [CLI](./docs/wiki/014-agent-cli-telemetry.md).
- **Design and data:** [domain glossary](./CONTEXT.md), [data model](./docs/schema.md), [ADR](./docs/adr/), [research](./docs/research/).
- **Resume development:** [handoff](./docs/handoff.md).

</details>

<a id="roadmap"></a>

The [Project board](https://github.com/users/12bitsD/projects/3) manages priorities and scheduling (access requires permission). [MVP scope](https://github.com/12bitsD/agent4novel/issues/1) preserves the original goals and subsequent decisions.

---

[Report a problem or suggest an improvement](https://github.com/12bitsD/agent4novel/issues) · [MIT License](./LICENSE)
