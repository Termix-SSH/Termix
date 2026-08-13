import { describe, expect, it } from "vitest";
import { defaultTrigger } from "@/sidebar/automations/TriggerCard";
import { emptyDraft } from "@/sidebar/automations/AutomationEditor";
import { newStepId } from "@/sidebar/automations/editor-types";
import { AUTOMATION_DEFINITION_VERSION } from "@/types/automations";

describe("emptyDraft", () => {
  it("starts on a metric threshold with no steps", () => {
    const draft = emptyDraft();
    expect(draft.name).toBe("");
    expect(draft.enabled).toBe(true);
    expect(draft.definition.version).toBe(AUTOMATION_DEFINITION_VERSION);
    expect(draft.definition.trigger.kind).toBe("metric_threshold");
    expect(draft.definition.steps).toEqual([]);
  });
});

describe("defaultTrigger", () => {
  it("gives every trigger kind a usable starting shape", () => {
    expect(defaultTrigger("metric_threshold")).toMatchObject({
      kind: "metric_threshold",
      operator: ">",
      cooldownMinutes: 15,
    });
    expect(defaultTrigger("host_status")).toMatchObject({
      kind: "host_status",
      to: "offline",
    });
    expect(defaultTrigger("health_check")).toMatchObject({
      kind: "health_check",
      to: "failing",
    });
    expect(defaultTrigger("schedule")).toMatchObject({ kind: "schedule" });
    expect(defaultTrigger("docker_event")).toMatchObject({
      kind: "docker_event",
      event: "exited",
    });
    expect(defaultTrigger("webhook")).toMatchObject({ kind: "webhook" });
  });

  it("defaults a schedule to a valid cron expression", () => {
    const trigger = defaultTrigger("schedule");
    expect(trigger).toHaveProperty("cron");
    // Five fields, which is what the backend parser requires.
    expect(
      String((trigger as { cron: string }).cron).split(/\s+/),
    ).toHaveLength(5);
  });
});

describe("newStepId", () => {
  it("produces distinct ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newStepId()));
    expect(ids.size).toBe(100);
  });
});
