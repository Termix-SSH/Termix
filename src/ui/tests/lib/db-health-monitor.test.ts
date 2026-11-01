import { afterEach, describe, expect, it, vi } from "vitest";
import { dbHealthMonitor } from "@/lib/db-health-monitor";

function watch() {
  const degraded = vi.fn<(...args: unknown[]) => void>();
  dbHealthMonitor.on("database-connection-degraded", degraded);
  return degraded;
}

describe("dbHealthMonitor", () => {
  let degraded: ReturnType<typeof watch>;

  afterEach(() => {
    dbHealthMonitor.off("database-connection-degraded", degraded);
    dbHealthMonitor.setReachabilityProbe(null);
    dbHealthMonitor.reset();
  });

  it("flags a network error at once", () => {
    degraded = watch();
    dbHealthMonitor.reportDatabaseError({ code: "ERR_NETWORK" });
    expect(degraded).toHaveBeenCalledTimes(1);
  });

  it("ignores canceled requests", () => {
    degraded = watch();
    dbHealthMonitor.reportDatabaseError({
      code: "ERR_CANCELED",
      message: "canceled",
    });
    expect(degraded).not.toHaveBeenCalled();
  });

  it("does not flag a timeout when the backend answers", async () => {
    degraded = watch();
    const probe = vi.fn(async () => true);
    dbHealthMonitor.setReachabilityProbe(probe);
    dbHealthMonitor.reportDatabaseError({
      code: "ECONNABORTED",
      message: "timeout of 30000ms exceeded",
    });
    await vi.waitFor(() => expect(probe).toHaveBeenCalled());
    await Promise.resolve();
    expect(degraded).not.toHaveBeenCalled();
  });

  it("flags a timeout when the check fails too", async () => {
    degraded = watch();
    dbHealthMonitor.setReachabilityProbe(async () => false);
    dbHealthMonitor.reportDatabaseError({
      code: "ECONNABORTED",
      message: "timeout of 30000ms exceeded",
    });
    await vi.waitFor(() => expect(degraded).toHaveBeenCalledTimes(1));
  });

  it("runs one check for timeouts at the same time", async () => {
    degraded = watch();
    let answer: (ok: boolean) => void = () => {};
    const probe = vi.fn(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    dbHealthMonitor.setReachabilityProbe(probe);
    dbHealthMonitor.reportDatabaseError({ code: "ECONNABORTED" });
    dbHealthMonitor.reportDatabaseError({ code: "ECONNABORTED" });
    answer(true);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(degraded).not.toHaveBeenCalled();
  });
});
