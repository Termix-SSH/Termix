import { describe, expect, it } from "vitest";
import {
  backendRssMb,
  countRequests,
  newestDevBranch,
  overBudget,
  parseArgs,
  requestKey,
} from "./budgets/lib.mjs";

describe("budget scripts", () => {
  it("reads flags", () => {
    expect(
      parseArgs(["--url", "http://x", "--warm", "--out", "r.json"]),
    ).toEqual({ url: "http://x", warm: true, out: "r.json" });
  });

  it("counts requests with ids folded", () => {
    expect(requestKey("get", "http://h/api/hosts/12/status")).toBe(
      "GET /api/hosts/:id/status",
    );
    expect(
      countRequests([
        { method: "GET", url: "http://h/rbac/permissions/me" },
        { method: "GET", url: "http://h/rbac/permissions/me" },
        { method: "GET", url: "http://h/hosts/1" },
        { method: "GET", url: "http://h/hosts/2" },
      ]),
    ).toEqual([
      { key: "GET /hosts/:id", count: 2 },
      { key: "GET /rbac/permissions/me", count: 2 },
    ]);
  });

  it("adds the backend's memory from the processes report", () => {
    expect(
      backendRssMb({
        core: { rssMb: 200 },
        plugins: [{ rssMb: 50 }, { rssMb: null }, { rssMb: 61.4 }],
      }),
    ).toBe(311);
    expect(backendRssMb(null)).toBeNull();
  });

  it("fails values over budget and missing ones", () => {
    const budgets = {
      framesAfterLogin: 30,
      jsHeapMb: 250,
      backendRssMb: 2500,
      timeToDashboardMs: 8000,
    };
    expect(
      overBudget(
        {
          framesAfterLogin: 24,
          jsHeapMb: 300,
          backendRssMb: null,
          timeToDashboardMs: 2000,
        },
        budgets,
      ),
    ).toEqual([
      { field: "jsHeapMb", value: 300, limit: 250 },
      { field: "backendRssMb", value: null, limit: 2500 },
    ]);
    expect(
      overBudget({ framesAfterLogin: 1 }, { framesAfterLogin: 30 }),
    ).toEqual([]);
  });

  it("picks the newest dev branch", () => {
    expect(
      newestDevBranch([
        "refs/heads/main",
        "refs/heads/dev-1.2.0",
        "refs/heads/dev-1.10.0",
        "refs/heads/dev-1.9.3",
        "refs/heads/feature-x",
      ]),
    ).toBe("dev-1.10.0");
    expect(newestDevBranch(["refs/heads/main"])).toBeNull();
  });
});
