## Agent skills

### Wiki context

Before planning, implementing, debugging, or reviewing existing behavior, read `.claude/skills/agent4novel-wiki/SKILL.md`. It is the project-level workflow for finding the minimum relevant ticket context and preserving design intent, code landing, and reasons for later changes when updating `docs/wiki/`.

### Runtime operations

Before starting the app, configuring a model, driving the pipeline, or diagnosing a live LLM run, read `.claude/skills/agent4novel-drive/SKILL.md`. This is the project-level operating skill for Codex and other agents. The canonical provider/configuration HOW is `docs/wiki/016-model-runtime-provider-config.md`.

### Issue tracker

Issues live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles map to the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`; per-ticket engineering context lives in `docs/wiki/`. See `docs/agents/domain.md`.
