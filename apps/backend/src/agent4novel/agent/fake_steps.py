from typing import Any

from ..domain.drafts import BeatReviewDraft, SettingReviewDraft
from ..domain.work import (
    AgentConfig,
    BeatContent,
    CaptionContent,
    CaptionElement,
    CreativeContent,
    CreativePack,
    Hint,
    OutlineContent,
    ProseContent,
    SettingContent,
)
from ..services.review_content import assign_beat_ids, assign_setting_ids
from ..text import utf16_slice


def fake_caption(seed: str) -> CaptionContent:
    return CaptionContent(
        inputStage="脑洞",
        summary=f"(演示)一份关于「{utf16_slice(seed, 0, 40)}」的素材,核心是一个差异化点子。",
        elements=[
            CaptionElement(kind="设定", content=f"基于输入:{utf16_slice(seed, 0, 50)}"),
            CaptionElement(kind="冲突", content="(演示)主角处境与目标之间的核心矛盾"),
        ],
        gaps=["(演示)主角动机未明确"],
    )


def fake_creative(work_id: str, seed: str, config: AgentConfig) -> CreativeContent:
    directions = []
    for index, flavor in enumerate(
        ["稳健王道", "黑深残", "轻松日常"][: config.directionCount or 2]
    ):
        directions.append(
            CreativePack(
                directionId=f"{work_id}-dir-{index + 1}",
                title=f"(演示)方向{'ABC'[index]}:{flavor}",
                hook=f"(演示)主角在「{utf16_slice(seed, 0, 30)}」中以{flavor}方式逆势崛起",
                tags=["演示", flavor],
                synopsis=(
                    f"(演示){utf16_slice(seed, 0, 60)}……故事以{flavor}基调展开,经转折抵达结局。"
                ),
                characters=[Hint(title="主角", content=f"(演示){flavor}路线的主人公")],
                setting=[
                    Hint(title="(演示)世界观", content=f"基于输入:{utf16_slice(seed, 0, 50)}")
                ],
                payoffs=[f"(演示){flavor}爽点:以小博大"],
                outline=[Hint(title="(演示)主线", content="开端 → 发展 → 高潮 → 结局")],
            )
        )
    return CreativeContent(directions=directions)


def fake_outline(work_id: str, seed: str) -> OutlineContent:
    arcs = []
    for index, title in enumerate(["开局立足", "冲突升级", "高潮收束"], start=1):
        arc_id = f"{work_id}-arc-{index}"
        arcs.append(
            {
                "arcId": arc_id,
                "title": f"(演示){title}",
                "conflict": f"(演示)第 {index} 弧核心冲突:基于「{utf16_slice(seed, 0, 30)}」的矛盾",
                "development": "(演示)冲突逐步升级,主角应对并成长",
                "resolution": "(演示)矛盾解决,收束到新的局势起点",
                "segments": [
                    {
                        "segmentId": f"{arc_id}-seg-{segment}",
                        "title": f"(演示)剧情点 {segment}",
                        "summary": f"(演示)本段发生的关键事件 {segment}",
                        "outcome": f"(演示)本段结束后的局势 {segment}",
                    }
                    for segment in [1, 2, 3]
                ],
            }
        )
    return OutlineContent.model_validate({"arcs": arcs})


def fake_setting(work_id: str, seed: str, creative: CreativeContent) -> SettingContent:
    direction = creative.directions[0]
    return assign_setting_ids(
        SettingReviewDraft.model_validate(
            {
                "overview": f"(演示){direction.synopsis}",
                "world": [
                    {
                        "title": "故事世界",
                        "content": (
                            f"(演示)基于「{utf16_slice(seed, 0, 80)}」展开，"
                            "世界规则在整部作品中保持一致。"
                        ),
                    }
                ],
                "characters": [
                    {
                        "title": "主角",
                        "content": f"(演示)围绕「{direction.hook}」行动，在关键选择中成长。",
                    }
                ],
                "factions": [],
                "relationships": [],
                "extensions": [],
            }
        )
    )


def fake_beat(
    chapter: int,
    outline: OutlineContent,
    setting: SettingContent,
    regeneration: Any = None,
    previous_chapter: Any = None,
) -> Any:
    segment = outline.arcs[0].segments[0]
    goal = (
        f"(演示再生){regeneration.content.goal}\n"
        f"修改意见：{regeneration.instructions or '重新安排本章'}"
        if regeneration is not None
        else f"(演示)围绕「{segment.title}」展开：{segment.summary}"
    )
    return assign_beat_ids(
        BeatReviewDraft.model_validate(
            {
                "title": "(演示)第一章：初遇变局"
                if chapter == 1
                else f"(演示)第 {chapter} 章：继续追寻",
                "goal": goal,
                "writingPlan": [
                    {
                        "title": "建立处境",
                        "content": (
                            "- 展示故事世界中的日常。\n"
                            "- 让主要人物在行动中出现。\n\n"
                            f"{setting.world[0].content}"
                        ),
                    },
                    {
                        "title": "遇到变化并选择",
                        "content": "引入打破日常的线索，让主角作出一个有代价的选择；留下后续追问。",
                    },
                ],
                "ending": (
                    f"(演示)朝「{segment.outcome}」迈出第一步，停在主角将要行动的位置，不提前完成整条弧线。"
                    if chapter == 1
                    else "(演示)完成本章行动后出现新的线索，保持故事继续推进。"
                ),
            }
        )
    )


def fake_prose(
    beat: BeatContent,
    setting: SettingContent,
    regeneration: Any = None,
    previous_chapter: Any = None,
) -> ProseContent:
    parts = [
        f"(演示){beat.title}。{beat.goal}",
        setting.world[0].content,
        *[item.content for item in beat.writingPlan],
    ]
    if previous_chapter is not None:
        parts.append(
            f"(演示)承接第 {previous_chapter.chapter} 章最终正文"
            f"（{len(previous_chapter.prose.text)} 字），继续人物的行动。"
        )
    if regeneration is not None:
        parts.extend(
            [
                regeneration.content.text,
                f"本次意见：{regeneration.instructions or '基于当前正文重新尝试。'}",
            ]
        )
    parts.append(beat.ending)
    return ProseContent(text="\n\n".join(parts))
