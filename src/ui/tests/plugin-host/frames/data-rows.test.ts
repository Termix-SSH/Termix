import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDataRow,
  dataRowsFor,
  frameRowContext,
  onDataRowsChange,
  resetDataRows,
} from "@/plugin-host/frames/data-rows";

afterEach(() => resetDataRows());

describe("data rows", () => {
  it("collects rows per plugin and value key and drops them again", () => {
    const stopA = addDataRow("metrics", "data:row", "1", { online: true });
    const stopB = addDataRow("metrics", "data:row", "2", { online: false });
    addDataRow("other", "data:row", "1", {});
    expect(dataRowsFor("metrics")).toEqual({
      "data:row": { "1": { online: true }, "2": { online: false } },
    });
    expect(dataRowsFor("other")).toEqual({ "data:row": { "1": {} } });
    stopA();
    expect(dataRowsFor("metrics")).toEqual({
      "data:row": { "2": { online: false } },
    });
    stopB();
    expect(dataRowsFor("metrics")).toEqual({});
  });

  it("tells listeners which plugin changed, only on real changes", () => {
    const listener = vi.fn();
    onDataRowsChange(listener);
    const stop = addDataRow("metrics", "k", "1", { a: 1 });
    expect(listener).toHaveBeenLastCalledWith("metrics");
    listener.mockClear();
    // The same row shown twice changes nothing a frame sees.
    const again = addDataRow("metrics", "k", "1", { a: 1 });
    expect(listener).not.toHaveBeenCalled();
    again();
    expect(listener).not.toHaveBeenCalled();
    stop();
    expect(listener).toHaveBeenCalledWith("metrics");
  });

  it("cuts a host to its id and drops what isn't plain data", () => {
    expect(
      frameRowContext({
        host: { id: 7, password: "secret", pluginSettings: { other: 1 } },
        online: true,
        onClick: () => {},
        missing: undefined,
      }),
    ).toEqual({ hostId: 7, online: true });
  });

  it("keeps an explicit host id and refuses oversized contexts", () => {
    expect(frameRowContext({ hostId: 3, host: { id: 9 } })).toEqual({
      hostId: 3,
    });
    expect(frameRowContext({ blob: "x".repeat(5000) })).toEqual({});
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(frameRowContext(cyclic)).toEqual({});
  });
});
