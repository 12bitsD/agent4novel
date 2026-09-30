<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel book mark" width="64" height="64">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">AI-assisted writing for Chinese web novels · Runs on your computer, in your browser</p>

<p align="center">
  <a href="#quick-start">Try it</a> ·
  <a href="#how-it-works">Writing workflow</a> ·
  <a href="#docs">Docs</a> ·
  <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="#current-status"><img src="https://img.shields.io/badge/status-in_development-555555?style=flat-square" alt="In development"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT License"></a>
</p>

Enter a story idea or upload text from a TXT, Markdown (`.md`), Word (`.docx`), or PDF document. AI proposes story directions, plans the plot, develops characters and world rules, and generates chapter prose. You choose the story direction, edit the content, and decide when to start the next chapter.

![The current app's chapter list, prose reading area, and editing control](./docs/assets/workspace-demo.jpg)

<p align="center"><sub>Actual interface in demo mode, shown in Chinese. The prose is a specially written example, not model output.</sub></p>

## How it works

The workflow has five stages for the author. To **approve** content means to accept it as a basis for subsequent writing.

| Stage | AI output | Author action |
| --- | --- | --- |
| **Choose a creative direction** | Two story directions by default, each with a synopsis, main characters, and conflict | Compare, edit, and select one |
| **Write the outline** | A plan for the whole book, describing how its main conflicts develop and resolve | Adjust the plot and approve the outline |
| **Develop the setting** | Characters, their relationships, world rules, and other background information | Add or edit details and approve the setting |
| **Plan a chapter** | A writing plan for one chapter: its goal, content order, and ending | Edit it or ask AI to regenerate it, then approve it |
| **Write the prose** | Chapter text based on the approved plan and setting | Edit it or ask AI to rewrite the chapter, then approve it |

Each chapter goes through both planning and prose. Approving the prose marks that chapter as complete. “Start next chapter” generates the next chapter plan. The chapter list lets you read earlier chapters and edit their approved prose.

Approved settings and chapter plans cannot currently be changed. After you edit approved prose in an earlier chapter, existing later chapters are flagged for a continuity check: the author needs to check whether the plot still connects. Their text and approval status are preserved; the app does not rewrite them automatically.

## Quick start

> **Works are saved on your computer.** Once prose is shown as saved, it survives server restarts when you use the same data directory. Unsaved changes in the page do not survive.

### Start with Docker (recommended)

Install Git and Docker with Compose support (for example, Docker Desktop), then run:

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
docker compose up --build -d --wait
```

Open **[localhost:8787](http://localhost:8787)** to use demo mode. One service provides Web and API, accessible only from your computer. Use `docker compose ps` to check health and `docker compose logs app` to diagnose startup failures. If the port is occupied, run `A4N_HTTP_PORT=8790 docker compose up --build -d --wait` and open that port.

Works live in a Docker data volume and survive container recreation. This bookshelf is separate from the `.data` directory used by source runs below. Stop with `docker compose stop`; see [container operations](./docs/wiki/033-local-docker-ci.md#维护操作) for backup, restore and upgrade commands.

### Start demo mode from source

These commands are for macOS and Linux terminals. Install Git, Node.js 22.13.0 or later, and pnpm 12.5.1. Builds and CI use Node.js 24.19.0:

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
pnpm install --frozen-lockfile
pnpm dev
```

Leave the program running in your terminal and open **[localhost:5173](http://localhost:5173)** in your browser.

With no model selected and no DeepSeek or LongCat API key (a secret for calling a model service), the app enters demo mode. Demo mode uses built-in sample content and supports selection, editing, and approval. **It does not call AI to generate a story.** Selecting a model without its corresponding key causes startup to fail.

The bookcase is empty on first startup, and you can create a work immediately. To add sample works, use `A4N_SEED_DEMO=1 pnpm dev` for the first startup. Samples are added only to an empty bookcase; restarting does not add duplicates.

### Configure a model service

**DeepSeek** and **LongCat** are currently supported. Obtain an API key from your chosen service.

Check that your prose is shown as saved, then stop the service: use `docker compose stop` for Docker, or press `Ctrl+C` in the terminal running from source. If `.env.local` already exists, edit it directly. For the first setup, run these commands from the `agent4novel` directory to create a configuration file that only your operating-system user can read and write:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

In `.env.local`, choose a model service, fill in its model name and API key, and leave the other settings unchanged:

| Model service | Value for `A4N_MODEL` | Field for your API key |
| --- | --- | --- |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| LongCat | `longcat:LongCat-2.0` | `LONGCAT_API_KEY` |

Save the file. For Docker, run `docker compose --env-file .env.local up --build -d --wait`; for source runs, use `pnpm dev`. Keys are passed at runtime and are not part of the image. Docker keeps its data directory in the volume; `.env.local` fields `A4N_DATA_DIR`, `A4N_HOST` and `A4N_PORT` apply only to source runs. Use `A4N_HTTP_PORT` for Docker's host port.

When you use a real model, your input and the story content needed for generation are sent to the chosen model service. Git does not add `.env.local` to version history by default; keep the key in that file. See [model configuration](./docs/wiki/016-model-runtime-provider-config.md#配置契约) for further options.

### Keep and back up your works

Docker uses a separate data volume. Continue using the same Compose project name when recovering works, and keep that volume. See [container backup and restore](./docs/wiki/033-local-docker-ci.md#维护操作) for commands.

For source runs, the default data file is `.data/agent4novel.sqlite` under the project directory. To use another location, set `A4N_DATA_DIR` in `.env.local` to an absolute directory path. Relative paths are resolved from the project root. Switching to an empty directory shows an empty bookcase; works in the original directory remain there.

To back up, stop all servers using that data directory, then copy the entire directory to a new backup location. To restore, stop the server, keep a backup of the current directory, and restore the entire directory from your chosen backup. Do not copy only the database file while the server is running. See [work storage and recovery](./docs/wiki/009-sqlite-persistence.md) for details and the limits of preserving data from older in-memory versions.

## Current status

**Chapter-by-chapter writing is available. The project is still in development.** Keep the following in mind when saving and using your works:

- **Works are saved on your computer.** Once prose is shown as saved, it survives browser refreshes and server restarts when you use the same data directory. Unsaved prose and unsubmitted manual edits to settings and chapter plans remain in the current page. Refreshing the page or discarding edits to leave loses those edits.
- **Interrupted generation needs a manual decision.** Restarting the server does not automatically call AI again. Open the work and check its saved content before continuing generation. Runtime diagnostic logs do not survive server restarts.
- **Full-novel generation quality has not yet been evaluated.** See the [chapter continuation verification record](./docs/wiki/006-chapter-continuation.md#测试与验证) for the scope and results of existing tests.

<a id="architecture"></a>

## Docs

**This README is for people using the app.** It covers the project, writing workflow, installation, and limitations.

**Engineering documentation is primarily for development and operations agents**: AI assistants that develop, test, or operate the project. Human developers can also consult it. The Wiki holds engineering design and verification records, Issues hold requirements and acceptance criteria, and Project holds priorities and scheduling. Most engineering documentation is in Chinese.

<a id="stack"></a>
<a id="development-process"></a>
<a id="development"></a>

<details>
<summary>Engineering documentation for agents</summary>

- **Development rules:** [AGENTS.md](./AGENTS.md) and the [completion checklist](./docs/agents/ticket-completion-checklist.md).
- **Operation and troubleshooting:** [runtime instructions](./.claude/skills/agent4novel-drive/SKILL.md), [model configuration](./docs/wiki/016-model-runtime-provider-config.md), [work storage and recovery](./docs/wiki/009-sqlite-persistence.md), [local containers and CI](./docs/wiki/033-local-docker-ci.md), and [command-line usage](./docs/wiki/014-agent-cli-telemetry.md).
- **Design and implementation:** [Engineering Wiki](./docs/wiki/README.md), [architecture decisions](./docs/adr/), and [research](./docs/research/).
- **Terms and data definitions:** [domain glossary](./CONTEXT.md) and [data model](./docs/schema.md).
- **Task handoff:** [handoff record](./docs/handoff.md).

</details>

## Roadmap

[Issues](https://github.com/12bitsD/agent4novel/issues) record requirements, acceptance criteria, and status. The [initial feature scope](https://github.com/12bitsD/agent4novel/issues/1) describes the planned capabilities. The [Project board](https://github.com/users/12bitsD/projects/3) manages priorities and scheduling; it is currently private and requires access permission.

---

<p align="center">
  <a href="https://github.com/12bitsD/agent4novel/issues">Report a problem or suggest an improvement</a> ·
  <a href="./LICENSE">MIT License</a>
</p>
