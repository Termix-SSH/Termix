import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Regression guard for Support#1216: routine status polling on a host with
// metrics disabled ran a full SSH authentication attempt on every interval,
// which fires a live 2FA push each cycle on RADIUS/Duo-backed devices with
// no active session. Spinning up the full metrics-service Express app (DB,
// SSH clients, timers, polling managers, etc.) just to drive pollHostStatus
// through two intervals is out of scope, so this asserts directly against
// the source that the status-poll path never calls into SSH auth, the same
// way login-alert-route-order.test.ts guards route registration order.
describe("metrics service status polling", () => {
  it("never authenticates over SSH from pollHostStatus, on the first poll or any later one", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../hosts/metrics/index.ts"),
      "utf8",
    );

    const pollHostStatusStart = source.indexOf("private async pollHostStatus(");
    const pollHostMetricsStart = source.indexOf(
      "private async pollHostMetrics(",
    );

    expect(pollHostStatusStart).toBeGreaterThan(-1);
    expect(pollHostMetricsStart).toBeGreaterThan(pollHostStatusStart);

    const pollHostStatusBody = source.slice(
      pollHostStatusStart,
      pollHostMetricsStart,
    );

    expect(pollHostStatusBody).not.toContain("withSshConnection");
    expect(pollHostStatusBody).not.toContain("statusAfterAuthentication");
  });
});
