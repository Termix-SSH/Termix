import { describe, expect, it } from "vitest";
import {
  createSnippetExecutionResult,
  getSnippetExecutionTimeoutMs,
  resolveSnippetCommand,
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

describe("resolveSnippetCommand", () => {
  const host = { ip: "10.0.0.5", username: "root", port: 22, name: "web-01" };

  it("substitutes host variables per target host", () => {
    expect(
      resolveSnippetCommand("ssh $USER@$HOST -p $PORT # $NAME", host),
    ).toBe("ssh root@10.0.0.5 -p 22 # web-01");
  });

  it("supports brace syntax for host variables", () => {
    expect(resolveSnippetCommand("ping ${HOST}", host)).toBe("ping 10.0.0.5");
  });

  it("substitutes input placeholders from inputValues", () => {
    expect(
      resolveSnippetCommand("nc -zv $HOST ${INPUT_1:Port}", host, {
        INPUT_1: "8080",
      }),
    ).toBe("nc -zv 10.0.0.5 8080");
  });

  it("leaves host variables literal when no host context is given", () => {
    expect(resolveSnippetCommand("ping $HOST", null)).toBe("ping $HOST");
  });

  it("leaves input placeholders literal when no value was supplied", () => {
    expect(resolveSnippetCommand("echo $INPUT_1", null)).toBe("echo $INPUT_1");
  });
});
