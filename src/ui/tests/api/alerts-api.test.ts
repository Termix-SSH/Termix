import { describe, expect, it } from "vitest";
import { mapAlertFiring } from "../../api/alerts-api";

describe("mapAlertFiring", () => {
  it("normalizes sqlite snake_case rows for the alerts UI", () => {
    expect(
      mapAlertFiring({
        id: 9,
        user_id: "u1",
        rule_id: 4,
        host_id: 12,
        host_name: "db-01",
        fired_at: "2026-06-30 12:00:00",
        resolved_at: null,
        value: 91,
        message: "CPU threshold exceeded",
        severity: "critical",
        acknowledged: 0,
        rule_name: "CPU",
      }),
    ).toEqual({
      id: 9,
      userId: "u1",
      ruleId: 4,
      hostId: 12,
      hostName: "db-01",
      firedAt: "2026-06-30 12:00:00",
      resolvedAt: null,
      value: 91,
      message: "CPU threshold exceeded",
      severity: "critical",
      acknowledged: false,
      ruleName: "CPU",
    });
  });

  it("uses safe defaults for malformed rows", () => {
    const firing = mapAlertFiring({ acknowledged: 1, severity: "bad" });

    expect(firing.id).toBe(0);
    expect(firing.hostName).toBe("");
    expect(firing.severity).toBe("warning");
    expect(firing.acknowledged).toBe(true);
  });
});
