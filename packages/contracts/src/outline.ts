import { z } from 'zod'

// outline(大纲,#4):与章节解耦的两层结构——弧线(arc)+ 剧情点(segment)。
// 弧线 = 一个冲突的完整生命周期(提出→发展→解决),作者把方向的对象;
// 剧情点 = 弧线内一个情节推进步骤(标题/概要/落点),章纲生成(#5)的切片单位。
// 章数不在本层:章节规划发生在章纲生成时。领域词见 CONTEXT.md「大纲/弧线/剧情点」。

const shortText = z.string().trim().min(1).max(100)
const midText = z.string().trim().min(1).max(500)

// 剧情点。segmentId 由 server 在生成落库时注入(形如 `w-3-arc-1-seg-2`),web 永不生成、编辑不得修改;
// outcome = 落点(本段结束时局势变成什么样),长线一致性锚点
export const outlineSegmentSchema = z
  .object({
    segmentId: z.string().trim().min(1).max(80),
    title: shortText.max(30),
    summary: midText,
    outcome: midText,
  })
  .strict()
export type OutlineSegment = z.infer<typeof outlineSegmentSchema>

// 弧线。arcId 由 server 注入(形如 `w-3-arc-1`);
// resolution = 矛盾解决,prompt 要求写清收束后的局势——它是下一弧的起点
export const outlineArcSchema = z
  .object({
    arcId: z.string().trim().min(1).max(80),
    title: shortText.max(30),
    conflict: midText,
    development: midText,
    resolution: midText,
    segments: z.array(outlineSegmentSchema).min(2).max(8),
  })
  .strict()
export type OutlineArc = z.infer<typeof outlineArcSchema>

export const outlineContentSchema = z
  .object({
    arcs: z.array(outlineArcSchema).min(3).max(8),
  })
  .strict()
export type OutlineContent = z.infer<typeof outlineContentSchema>

// 保存输入形态(#4 决策 6):作者增删改回传时,新增项没有 id(由 server 规整时补注入),已有项 id 保留。
// 存储/落库形态一律是上面的 outlineContentSchema(id 必填)。
export const outlineDraftSchema = z
  .object({
    arcs: z
      .array(
        outlineArcSchema.omit({ arcId: true, segments: true }).extend({
          arcId: z.string().trim().min(1).max(80).optional(),
          segments: z
            .array(
              outlineSegmentSchema.omit({ segmentId: true }).extend({
                segmentId: z.string().trim().min(1).max(80).optional(),
              }),
            )
            .min(2)
            .max(8),
        }),
      )
      .min(3)
      .max(8),
  })
  .strict()
export type OutlineDraft = z.infer<typeof outlineDraftSchema>
