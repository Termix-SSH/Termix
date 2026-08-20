import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../ai/context.js";

const BASE = { hostCount: 3, allowReadOnlyCommands: false };

describe("buildSystemPrompt", () => {
  it("tells the assistant to stay inside what was asked", () => {
    // Without these the assistant answered "what is running on this server"
    // by also proposing a monitoring script and an alert rule nobody wanted.
    const prompt = buildSystemPrompt(BASE);

    expect(prompt).toContain("nothing beyond it");
    expect(prompt).toMatch(/Read, then report\. Do not propose anything\./);
    expect(prompt).toMatch(/no monitoring, no alert rules, no scripts/);
    expect(prompt).toMatch(/One request means one proposal at most/);
  });

  it("states that it proposes rather than applies", () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toContain("cannot change anything directly");
    expect(prompt).toContain("Never claim you have done something");
  });

  it("never claims credential access", () => {
    const prompt = buildSystemPrompt(BASE);
    expect(prompt).toMatch(/no access to passwords, SSH keys, API keys/);
  });

  it("mentions read-only commands only when the user opted in", () => {
    expect(buildSystemPrompt(BASE)).not.toMatch(/read-only diagnostic/);
    expect(buildSystemPrompt({ ...BASE, allowReadOnlyCommands: true })).toMatch(
      /read-only diagnostic/,
    );
  });

  it("pluralises the host count", () => {
    expect(buildSystemPrompt({ ...BASE, hostCount: 1 })).toContain("1 host ");
    expect(buildSystemPrompt({ ...BASE, hostCount: 2 })).toContain("2 hosts");
  });

  it("includes the active tab only when there is one", () => {
    expect(buildSystemPrompt(BASE)).not.toContain("currently looking at");
    expect(buildSystemPrompt({ ...BASE, activeTab: "terminal" })).toContain(
      "currently looking at: terminal",
    );
  });
});
