import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

from ..agent.runtime import ModelRuntime
from ..config import ModelConfigError, parse_model_id
from ..domain.resources import (
    AUTHOR_STEP_IDS,
    AgentFile,
    AuthorConfigDocument,
    AuthorConfigView,
    AuthorPreferences,
    AuthorStepConfig,
    EffectiveAuthorStep,
    PreferenceName,
)
from ..domain.work import AgentConfig, AgentConfigFile, WorkDetail
from ..errors import ConfigInvalidError, KnownError
from ..store.sqlite import WorkNotFoundError
from ..text import utf16_length
from .files import AgentFileUnavailableError, read_agent_file
from .skill_files import parse_skill_text


def _default_model_id(env: Mapping[str, str]) -> str:
    explicit = env.get("A4N_MODEL", "").strip()
    if explicit:
        return explicit
    if env.get("DEEPSEEK_API_KEY", "").strip():
        return "deepseek:deepseek-chat"
    if env.get("LONGCAT_API_KEY", "").strip():
        return "longcat:LongCat-2.0"
    if env.get("KIMI_API_KEY", "").strip() or env.get("MOONSHOT_API_KEY", "").strip():
        return "kimi:kimi-k2.8-highspeed"
    return "deepseek:deepseek-chat"


def _provider_for_model(model: str) -> Literal["deepseek", "longcat", "kimi"]:
    provider = model.split(":", 1)[0]
    if provider == "deepseek":
        return "deepseek"
    if provider == "longcat":
        return "longcat"
    if provider == "kimi":
        return "kimi"
    raise ConfigInvalidError


def _generation(model: str, selected: dict[str, Any]) -> dict[str, Any]:
    thinking = selected.get("thinking")
    if thinking is not None and model != "longcat:LongCat-2.0":
        raise ConfigInvalidError
    if model == "longcat:LongCat-2.0":
        return {
            "thinking": thinking or "disabled",
            "temperature": selected.get("temperature", 0.9),
            "topP": selected.get("topP", 0.95),
        }
    return {
        **({"thinking": thinking} if thinking is not None else {}),
        **({"temperature": selected["temperature"]} if "temperature" in selected else {}),
        **({"topP": selected["topP"]} if "topP" in selected else {}),
    }


class AuthorConfigService:
    def __init__(
        self,
        store: Any,
        env: Mapping[str, str],
        data_dir: Path | None = None,
        runtime: ModelRuntime | None = None,
    ) -> None:
        self.store = store
        self.env = env
        self.data_dir = data_dir
        self.runtime = runtime or ModelRuntime(env)

    def _find(self, files: list[AgentFile], file_id: str, kind: str) -> AgentFile:
        file = next((item for item in files if item.id == file_id and item.kind == kind), None)
        if file is None:
            raise ConfigInvalidError
        return file

    def get(self, work_id: str) -> AuthorConfigView:
        work = self.store.get_work(work_id)
        if work is None:
            raise WorkNotFoundError
        saved = self.store.get_author_config(work_id)
        document = (
            saved.document
            if saved
            else AuthorConfigDocument(
                preferences=AuthorPreferences(), defaults=AuthorStepConfig(), steps={}
            )
        )
        return self.resolve(work, document, saved.revision if saved else 0)

    def resolve(
        self, work: WorkDetail, document: AuthorConfigDocument, revision: int
    ) -> AuthorConfigView:
        files = self.store.list_agent_files(work.id)
        legacy: AgentConfig | dict[str, Any] = work.config if revision == 0 else {}
        default_model = self.runtime.default_model_id
        demo = self.runtime.mode == "demo"
        effective = []
        for step_id in AUTHOR_STEP_IDS:
            selected = {
                **document.defaults.model_dump(),
                **(document.steps.get(step_id) or AuthorStepConfig()).model_dump(),
            }
            model = selected.get("model") or getattr(legacy, "model", None) or default_model
            try:
                parse_model_id(model)
                if not demo:
                    self.runtime.provider_config(model)
            except (ModelConfigError, KnownError) as error:
                raise ConfigInvalidError from error
            prompt = (
                self._find(files, selected["systemPromptRef"], "prompt")
                if selected.get("systemPromptRef")
                else None
            )
            skills = [self._find(files, file_id, "skill") for file_id in selected.get("skills", [])]
            applied: dict[PreferenceName, str] = {}
            if document.preferences.style and step_id == "prose":
                applied["style"] = document.preferences.style
            if document.preferences.genre and step_id != "caption":
                applied["genre"] = document.preferences.genre
            if document.preferences.payoff and step_id in {"creative", "outline", "beat", "prose"}:
                applied["payoff"] = document.preferences.payoff
            effective.append(
                EffectiveAuthorStep(
                    id=step_id,
                    model=model,
                    provider=_provider_for_model(model),
                    configured=not demo,
                    executionMode="demo" if demo else "live",
                    generation=_generation(model, selected),
                    appliedPreferences=applied,
                    systemPrompt=prompt,
                    skills=skills,
                    tools=[],
                    directionCount=selected.get("directionCount")
                    or getattr(legacy, "directionCount", None)
                    or 2,
                )
            )
        view = AuthorConfigView(
            workId=work.id,
            revision=revision,
            document=document,
            files=files,
            effective=effective,
        )
        for step in view.effective:
            self._guidance(work, view, step)
        return view

    @staticmethod
    def _skill_body(file: AgentFile, text: str) -> str:
        metadata = parse_skill_text(text)
        if metadata.name != file.name or metadata.description != file.description:
            raise ConfigInvalidError
        return metadata.body

    def _read_body(self, file: AgentFile) -> str:
        if self.data_dir is None:
            raise ConfigInvalidError
        return self._skill_body(file, read_agent_file(self.data_dir, file).text)

    @staticmethod
    def _selected(document: AuthorConfigDocument, step_id: Any) -> dict[str, Any]:
        return {
            **document.defaults.model_dump(),
            **(document.steps.get(step_id) or AuthorStepConfig()).model_dump(),
        }

    def _guidance(self, work: WorkDetail, view: AuthorConfigView, step: EffectiveAuthorStep) -> str:
        parts = []
        if step.appliedPreferences:
            parts.append(
                "Author preferences: "
                + json.dumps(step.appliedPreferences, ensure_ascii=False, separators=(",", ":"))
            )
        selected = self._selected(view.document, step.id)
        if step.systemPrompt is not None:
            parts.append(self._read_body(step.systemPrompt))
        elif "systemPromptRef" not in selected and view.revision == 0 and work.config.systemPrompt:
            parts.append(work.config.systemPrompt)
        parts.extend(f"Skill {file.name}:\n{self._read_body(file)}" for file in step.skills)
        guidance = "\n\n".join(parts)
        if utf16_length(guidance) > 48_000:
            raise ConfigInvalidError
        return guidance

    def snapshot(
        self, work: WorkDetail, view: AuthorConfigView | None = None
    ) -> dict[str, AgentConfig]:
        try:
            view = view or self.get(work.id)
            configs: dict[str, AgentConfig] = {}
            for step in view.effective:
                guidance = self._guidance(work, view, step)
                files = [*([step.systemPrompt] if step.systemPrompt else []), *step.skills]
                generation = {
                    key: step.generation[key]
                    for key in ("thinking", "temperature", "topP")
                    if key in step.generation
                }
                configs[step.id] = AgentConfig(
                    model=step.model,
                    systemPrompt=guidance,
                    skills=[],
                    tools=[],
                    directionCount=step.directionCount,
                    **generation,
                    configRevision=view.revision,
                    configFiles=[AgentConfigFile(id=file.id, sha256=file.sha256) for file in files],
                )
            return configs
        except ConfigInvalidError as error:
            raise KnownError("config-invalid", "invalid author configuration or file") from error
        except AgentFileUnavailableError as error:
            raise KnownError(
                "agent-file-unavailable", "selected agent file is unavailable or changed"
            ) from error
