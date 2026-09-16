import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
const source = fs.readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const start = source.indexOf("function buildAiAgentMessages(");
const end = source.indexOf("function validateAiAgentAction(", start);
const build = vm.runInNewContext(
  source.slice(start, end) + "\nbuildAiAgentMessages",
  {
    redactAiText: (value: unknown) => String(value ?? ""),
    AI_MAX_CONTEXT_LENGTH: 12000,
    AI_MAX_PROMPT_LENGTH: 4000,
    AI_AGENT_HISTORY_LIMIT: 12,
  },
);
describe("terminal context preference", () => {
  it.each([false, true])(
    "honors includeContext=%s for both context and captured history",
    (enabled) => {
      const messages = build(
        {
          prompt: "list files",
          mode: "safe",
          history: [
            { role: "terminal", text: "private-output" },
            { role: "user", text: "explicit instruction" },
          ],
        },
        { context: { visibleOutput: "private-context" } },
        enabled,
      );
      const serialized = JSON.stringify(messages);
      expect(serialized.includes("private-output")).toBe(enabled);
      expect(serialized.includes("private-context")).toBe(enabled);
      expect(serialized).toContain("explicit instruction");
    },
  );
});
