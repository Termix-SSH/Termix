import { describe, expect, it } from "vitest";
import {
  createSnippetExecutionResult,
  getSnippetExecutionTimeoutMs,
} from "../../../database/routes/snippets-execution.js";

describe("snippet execution", () => {
  it("treats stderr as diagnostic output when the command succeeds", () => {
    expect(createSnippetExecutionResult(0, "done\n", "warning\n")).toEqual({
      success: true,
      output: "done\n",
      error: "warning\n",
    });
  });

  it("uses the exit code to report command failure", () => {
    expect(createSnippetExecutionResult(1, "", "failed\n")).toEqual({
      success: false,
      output: "",
      error: "failed\n",
    });
  });

  it("preserves the previous fallback when no exit code is available", () => {
    expect(createSnippetExecutionResult(null, "done\n", "")).toEqual({
      success: true,
      output: "done\n",
    });
    expect(createSnippetExecutionResult(null, "", "failed\n").success).toBe(
      false,
    );
  });

  it("disables the command timeout by default", () => {
    expect(getSnippetExecutionTimeoutMs(undefined)).toBeUndefined();
  });

  it("converts a configured timeout from seconds to milliseconds", () => {
    expect(getSnippetExecutionTimeoutMs("45")).toBe(45_000);
  });

  it.each(["", "0", "-1", "invalid"])(
    "ignores invalid timeout value %j",
    (value) => {
      expect(getSnippetExecutionTimeoutMs(value)).toBeUndefined();
    },
  );
});
