import { z } from "zod";
import {
  beatContentSchema,
  beatEditDraftSchema,
  beatLimits,
  outlineContentSchema,
  settingContentSchema,
} from "@agent4novel/contracts";
import {
  chapterNumberSchema,
  previousChapterSchema,
  validatePreviousChapter,
} from "./chapter-context.js";

// superRefine：处理当前步骤。
// strict：处理当前步骤。
// object：处理当前步骤。
// string：处理当前步骤。
// string：处理当前步骤。
// strict：处理当前步骤。
// object：处理当前步骤。
// optional：处理当前步骤。
// optional：处理当前步骤。
// strict：处理当前步骤。
// object：处理当前步骤。
// max：处理当前步骤。
// string：处理当前步骤。
export const beatStepInputSchema = z
  .object({
    workId: z.string(),
    seed: z.string(),
    chapter: chapterNumberSchema,
    upstream: z
      .object({
        outline: outlineContentSchema,
        setting: settingContentSchema,
        previousChapter: previousChapterSchema.optional(),
      })
      .strict(),
    regeneration: z
      .object({
        content: beatEditDraftSchema,
        instructions: z.string().max(beatLimits.instructions),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine(validatePreviousChapter);
// object：处理当前步骤。
export const beatStepOutputSchema = z.object({ content: beatContentSchema });
