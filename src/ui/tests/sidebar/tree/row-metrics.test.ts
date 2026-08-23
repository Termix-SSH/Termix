import { describe, it, expect } from "vitest";
import {
  RESOURCE_ROW_EXTRA,
  rendersResourceRow,
} from "@/sidebar/tree/row-metrics";

const host = (
  over: Partial<{ online: boolean; cpu: number; ram: number }>,
) => ({
  online: false,
  cpu: null,
  ram: null,
  ...over,
});

describe("rendersResourceRow", () => {
  it("reserves the bars for an online host reporting CPU", () => {
    expect(
      rendersResourceRow(host({ online: true, cpu: 42 }), true, false),
    ).toBe(true);
  });

  it("reserves the bars for an online host reporting only RAM", () => {
    expect(
      rendersResourceRow(host({ online: true, ram: 70 }), true, false),
    ).toBe(true);
  });

  // The gap this whole helper exists for: offline rows reserved bar height
  // they never rendered, leaving dead space under every row in a long list.
  it("reserves nothing for an offline host", () => {
    expect(
      rendersResourceRow(host({ online: false, cpu: 42 }), true, false),
    ).toBe(false);
  });

  it("reserves nothing for an online host with no metrics yet", () => {
    expect(rendersResourceRow(host({ online: true }), true, false)).toBe(false);
  });

  it("reserves nothing when cpu and ram are zero", () => {
    expect(
      rendersResourceRow(host({ online: true, cpu: 0, ram: 0 }), true, false),
    ).toBe(false);
  });

  it("reserves nothing when the bars are turned off", () => {
    expect(
      rendersResourceRow(host({ online: true, cpu: 42 }), false, false),
    ).toBe(false);
  });

  it("reserves nothing in compact density, which drops the row", () => {
    expect(
      rendersResourceRow(host({ online: true, cpu: 42 }), true, true),
    ).toBe(false);
  });
});

describe("RESOURCE_ROW_EXTRA", () => {
  it("matches the measured height of the bar row", () => {
    expect(RESOURCE_ROW_EXTRA).toBe(17.25);
  });
});
