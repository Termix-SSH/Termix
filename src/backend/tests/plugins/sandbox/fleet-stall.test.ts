import { describe, expect, it } from "vitest";
import { waitOutFleetStall } from "../../../plugins/sandbox/supervisor.js";

const T = 30_000;

describe("waitOutFleetStall", () => {
  it("waits when most running plugins went quiet together", () => {
    expect(waitOutFleetStall(18, 20, T + 1, T)).toBe(true);
    expect(waitOutFleetStall(2, 4, T + 1, T)).toBe(true);
  });

  it("restarts one plugin that hung while the others answer", () => {
    expect(waitOutFleetStall(1, 20, T + 1, T)).toBe(false);
    expect(waitOutFleetStall(4, 10, T + 1, T)).toBe(false);
  });

  it("judges each plugin on its own when only a few run", () => {
    expect(waitOutFleetStall(2, 2, T + 1, T)).toBe(false);
  });

  it("restarts them anyway once the shared stall runs too long", () => {
    expect(waitOutFleetStall(20, 20, T * 3 + 1, T)).toBe(false);
  });
});
