import type { z } from "zod";
import type { ApiError, ValidationIssue } from "@agent4novel/contracts";

export function formatValidationIssues(
  issues: z.ZodIssue[],
  pathFor: (issue: z.ZodIssue) => ValidationIssue["path"] = (issue) =>
    issue.path,
): Pick<ApiError, "issues" | "issueCount" | "issuesTruncated"> {
  // map：转换数组元素。
  // slice：截取片段。
  // pathFor：处理当前步骤。
  return {
    issues: issues.slice(0, 128).map((issue) => ({
      path: pathFor(issue),
      code: issue.code,
      message: "invalid field",
    })),
    ...(issues.length > 128
      ? { issueCount: issues.length, issuesTruncated: true }
      : {}),
  };
}
