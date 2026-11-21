import { beforeEach, describe, expect, it } from "vitest";
import {
  cleanSectionData,
  collectDiagnosticsSections,
  hasDiagnosticsSection,
  MAX_SECTION_BYTES,
  provideDiagnosticsSection,
  resetDiagnosticsSections,
} from "../../diagnostics/sections.js";

beforeEach(() => resetDiagnosticsSections());

describe("diagnostics sections", () => {
  it("collects each plugin's section", async () => {
    provideDiagnosticsSection("ssh-terminal", {
      title: "Sessions",
      collect: () => ({ open: 2 }),
    });
    provideDiagnosticsSection("docker", { collect: async () => [1, 2] });
    const sections = await collectDiagnosticsSections();
    expect(sections).toEqual([
      { pluginId: "ssh-terminal", title: "Sessions", data: { open: 2 } },
      { pluginId: "docker", title: "docker", data: [1, 2] },
    ]);
    expect(await collectDiagnosticsSections("docker")).toHaveLength(1);
  });

  it("replaces a plugin's section and removes only its own", async () => {
    const first = provideDiagnosticsSection("a", { collect: () => 1 });
    provideDiagnosticsSection("a", { collect: () => 2 });
    first();
    expect(hasDiagnosticsSection("a")).toBe(true);
    expect((await collectDiagnosticsSections())[0].data).toBe(2);
  });

  it("masks secrets and refuses big or broken answers", () => {
    expect(
      cleanSectionData({ password: "p", nested: { apiToken: "t", ok: 1 } }),
    ).toEqual({
      password: "[MASKED]",
      nested: { apiToken: "[MASKED]", ok: 1 },
    });
    expect(cleanSectionData("x".repeat(MAX_SECTION_BYTES + 10))).toMatch(
      /^\[too big/,
    );
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(cleanSectionData(loop)).toBe("[could not be read as JSON]");
  });

  it("reports a slow or failing section as an error", async () => {
    provideDiagnosticsSection("slow", {
      collect: () => new Promise(() => {}),
    });
    provideDiagnosticsSection("bad", {
      collect: () => {
        throw new Error("broke with token=abc");
      },
    });
    const sections = await collectDiagnosticsSections(undefined, 20);
    expect(sections.find((s) => s.pluginId === "slow")?.error).toBe(
      "Timed out",
    );
    expect(sections.find((s) => s.pluginId === "bad")?.error).toBe(
      "broke with token=[MASKED]",
    );
  });

  it("needs collect", () => {
    expect(() =>
      provideDiagnosticsSection("x", {} as unknown as { collect: () => 1 }),
    ).toThrow();
  });
});
