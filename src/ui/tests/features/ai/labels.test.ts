import { describe, expect, it } from "vitest";
import {
  fieldLabel,
  humanize,
  mentionLabel,
  toolLabel,
} from "@/features/ai/labels";
import { AI_TOOLS } from "../../../../backend/ai/tools/catalog";

describe("humanize", () => {
  it("splits camelCase into words", () => {
    // The case that shipped as "thresholddurationseconds".
    expect(humanize("thresholdDurationSeconds")).toBe(
      "Threshold duration seconds",
    );
  });

  it("splits snake_case into words", () => {
    expect(humanize("propose_create_alert_rule")).toBe(
      "Propose create alert rule",
    );
  });

  it("leaves a single word alone apart from casing", () => {
    expect(humanize("port")).toBe("Port");
  });

  it("returns the input when there is nothing to split", () => {
    expect(humanize("")).toBe("");
  });
});

describe("fieldLabel", () => {
  it("uses the mapped name where there is one", () => {
    expect(fieldLabel("thresholdDurationSeconds")).toBe("Duration (seconds)");
    expect(fieldLabel("cooldownMinutes")).toBe("Cooldown (minutes)");
    expect(fieldLabel("ip")).toBe("Address");
  });

  it("falls back to humanizing an unmapped key", () => {
    expect(fieldLabel("someFutureField")).toBe("Some future field");
  });

  it("never returns a run-on identifier", () => {
    for (const key of ["thresholdDurationSeconds", "hostIds", "triggerType"]) {
      expect(fieldLabel(key)).not.toBe(key.toLowerCase());
    }
  });
});

describe("toolLabel", () => {
  it("phrases tools as actions rather than function names", () => {
    expect(toolLabel("list_hosts")).toBe("Reading hosts");
    expect(toolLabel("propose_create_alert_rule")).toBe("Create alert rule");
  });

  it("covers every tool in the catalog", () => {
    // A new tool without a label would surface its raw snake_case name.
    for (const tool of AI_TOOLS) {
      const label = toolLabel(tool.name);
      expect(label, tool.name).not.toContain("_");
      expect(label, tool.name).not.toBe(tool.name);
    }
  });
});

describe("mentionLabel", () => {
  it("capitalises the mention kinds", () => {
    expect(mentionLabel("host")).toBe("Host");
    expect(mentionLabel("snippet")).toBe("Snippet");
    expect(mentionLabel("automation")).toBe("Automation");
  });
});
