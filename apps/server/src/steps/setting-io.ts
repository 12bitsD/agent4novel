import { z } from "zod";
import {
  captionContentSchema,
  creativeContentSchema,
  outlineContentSchema,
  settingContentSchema,
} from "@agent4novel/contracts";

// object：处理当前步骤。
// string：处理当前步骤。
// string：处理当前步骤。
// object：处理当前步骤。
// refine：处理当前步骤。
export const settingStepInputSchema = z.object({
  workId: z.string(),
  seed: z.string(),
  upstream: z.object({
    caption: captionContentSchema,
    creative: creativeContentSchema.refine(
      (content) => content.directions.length === 1,
      "creative must contain one selected direction",
    ),
    outline: outlineContentSchema,
  }),
});
// object：处理当前步骤。
export const settingStepOutputSchema = z.object({
  content: settingContentSchema,
});
