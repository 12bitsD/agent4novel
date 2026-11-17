import { z } from "zod";
import {
  beatContentSchema,
  settingContentSchema,
  proseContentSchema,
  proseEditDraftSchema,
  proseLimits,
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
export const proseStepInputSchema = z
  .object({
    workId: z.string(),
    seed: z.string(),
    chapter: chapterNumberSchema,
    upstream: z
      .object({
        beat: beatContentSchema,
        setting: settingContentSchema,
        previousChapter: previousChapterSchema.optional(),
      })
      .strict(),
    regeneration: z
      .object({
        content: proseEditDraftSchema,
        instructions: z.string().max(proseLimits.instructions),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine(validatePreviousChapter);
// strict：处理当前步骤。
// object：处理当前步骤。
export const proseStepOutputSchema = z
  .object({ content: proseContentSchema })
  .strict();
