import { z } from "zod";
import { beatContentSchema, proseContentSchema } from "@agent4novel/contracts";

// safe：处理当前步骤。
// positive：处理当前步骤。
// int：处理当前步骤。
// number：处理当前步骤。
export const chapterNumberSchema = z.number().int().positive().safe();
// strict：处理当前步骤。
// object：处理当前步骤。
export const previousChapterSchema = z
  .object({
    chapter: chapterNumberSchema,
    beat: beatContentSchema,
    prose: proseContentSchema,
  })
  .strict();

// Both production and isolated Steps require precisely the preceding
// approved chapter.
export function validatePreviousChapter(
  input: {
    chapter: number;
    upstream: { previousChapter?: z.infer<typeof previousChapterSchema> };
  },
  ctx: z.RefinementCtx,
): void {
  const previous = input.upstream.previousChapter;
  if (
    input.chapter === 1
      ? previous !== undefined
      : previous?.chapter !== input.chapter - 1
  ) {
    // addIssue：处理当前步骤。
    ctx.addIssue({
      code: "custom",
      path: ["upstream", "previousChapter"],
      message:
        "previousChapter must match chapter - 1 and must be absent for chapter 1",
    });
  }
}
