<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel" width="280">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">
  <strong>AI-assisted writing for Chinese web novels</strong><br>
  Authors choose the direction, edit generated content, and decide when to continue.
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#quick-start">Try it</a> ·
  <a href="#docs">Read the docs</a> ·
  <a href="#roadmap">Development plans</a> ·
  <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-5B6ABF" alt="MIT License"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/demo-no_API_key-2D8A78" alt="Demo mode needs no API key"></a>
  <a href="#current-status"><img src="https://img.shields.io/badge/status-in_development-C47742" alt="In development"></a>
</p>

---

**agent4novel is an open-source tool for writing Chinese web novels. It runs on your computer and you use it in a browser.** It is for authors who have a story idea and want AI assistance with planning and writing one chapter at a time.

Enter a story idea or upload text from a TXT, Markdown (`.md`), Word (`.docx`), or PDF document. AI uses this material to propose story directions, plan the plot, develop characters and world rules, and generate chapter prose.

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

## Current status

**Chapter-by-chapter writing is available. The project is still in development.** Current limitations:

- **Stopping or restarting the server clears works.** Work data is held in the memory of the local server started by `pnpm dev`; it is not yet written to disk. Copy any text you need into local files.
- **Prose saves automatically to the local server.** Once the page shows that it is saved, a browser refresh can recover it as long as the server has not stopped or restarted. Unsubmitted manual edits to settings and chapter plans remain in the current page. Refreshing the page or discarding edits to leave loses those edits.
- **Full-novel generation quality has not yet been evaluated.** See the [chapter continuation verification record](./docs/wiki/006-chapter-continuation.md#测试与验证) for the scope and results of existing tests.

## Quick start

### 1. Start demo mode

These commands are for macOS and Linux terminals. Install Git (to download the source), Node.js (to run the program), and pnpm (to install dependencies), then run:

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
pnpm install
pnpm dev
```

Leave the program running in your terminal and open **[localhost:5173](http://localhost:5173)** in your browser.

With no model selected and no DeepSeek or LongCat API key (a secret for calling a model service), the app enters demo mode. Demo mode uses built-in sample content and supports selection, editing, and approval. **It does not call AI to generate a story.** Selecting a model without its corresponding key causes startup to fail.

### 2. Configure a model service

**DeepSeek** and **LongCat** are currently supported. Obtain an API key from your chosen service.

Copy any text you need to keep, then press `Ctrl+C` in the terminal running `pnpm dev` to stop the server. If `.env.local` already exists, edit it directly. For the first setup, run these commands from the `agent4novel` directory to create a configuration file that only your operating-system user can read and write:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

In `.env.local`, choose a model service, fill in its model name and API key, and leave the other settings unchanged:

| Model service | Value for `A4N_MODEL` | Field for your API key |
| --- | --- | --- |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| LongCat | `longcat:LongCat-2.0` | `LONGCAT_API_KEY` |

Save the file and run `pnpm dev` again.

When you use a real model, your input and the story content needed for generation are sent to the chosen model service. Git does not add `.env.local` to version history by default; keep the key in that file. See [model configuration](./docs/wiki/016-model-runtime-provider-config.md#配置契约) for further options.

<a id="architecture"></a>

## Docs

Most engineering documentation is in Chinese.

| Topic | Documentation |
| --- | --- |
| How to configure a model and its generation settings | [Model configuration](./docs/wiki/016-model-runtime-provider-config.md) |
| How to operate works from the command line or run one generation step | [Command-line usage](./docs/wiki/014-agent-cli-telemetry.md) |
| Why a feature was designed this way, how it works, and how it was verified | [Engineering Wiki](./docs/wiki/README.md) |
| What the project's terms mean | [Domain glossary](./CONTEXT.md) |
| How to contribute | [Development instructions](./AGENTS.md) |

## Roadmap

The [issue list](https://github.com/12bitsD/agent4novel/issues) records feature requests, acceptance criteria, and their status. The [initial feature scope](https://github.com/12bitsD/agent4novel/issues/1) describes the planned capabilities.

Maintainers use the [Project board](https://github.com/users/12bitsD/projects/3) to set priorities and development order. The board is currently private and requires access permission.

<a id="stack"></a>
<a id="development-process"></a>

## Development

The frontend uses React and Vite; the server uses Hono. The code is written in TypeScript, and model calls use the Vercel AI SDK.

Run these commands from the repository root:

```bash
pnpm test        # run tests without calling remote models
pnpm typecheck   # check TypeScript types
pnpm build       # build the frontend
```

The command-line tool supports creating works, generating content, and submitting edits. Scripts and AI coding assistants can call it. View its help with:

```bash
./apps/cli/bin/a4n --help
```

---

<p align="center">
  <a href="https://github.com/12bitsD/agent4novel/issues">Report a problem or suggest an improvement</a> ·
  <a href="./LICENSE">MIT License</a>
</p>
