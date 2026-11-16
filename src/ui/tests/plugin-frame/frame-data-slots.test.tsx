import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { DataSlot } from "@/components/data-view/DataSlot";
import { setFrameDataSource } from "@/components/data-view/data-source";
import {
  createFrameDataSource,
  receiveDataSlot,
} from "@/plugin-frame/frame-data-slots";

afterEach(() => setFrameDataSource(null));

describe("a data slot inside a frame", () => {
  it("asks the shell to watch the row and draws what comes back", async () => {
    const call = vi.fn(async (method: string, ...args: unknown[]) =>
      method === "dataSlot.watch" ? args.length > 0 : undefined,
    );
    setFrameDataSource(createFrameDataSource(call));
    const view = render(
      <DataSlot
        slotId="homepage.hostMetrics"
        rowKey={3}
        context={{
          hostId: 3,
          host: { id: 3, pluginSettings: { mine: 1 } },
          shownMetrics: ["cpu"],
        }}
        fallback={<span>none yet</span>}
      />,
    );
    expect(view.container.textContent).toBe("none yet");
    const [method, id, watch] = call.mock.calls[0];
    expect(method).toBe("dataSlot.watch");
    // Only plain data leaves the frame; the host goes as its id.
    expect(watch).toEqual({
      slotId: "homepage.hostMetrics",
      rowKey: "3",
      context: { hostId: 3, shownMetrics: ["cpu"] },
    });

    await act(async () => {
      receiveDataSlot({
        id,
        values: [
          {
            actionId: "metrics.home",
            pluginId: "metrics",
            parts: [
              { shape: "bars", items: [{ label: "CPU", value: 0.5 }] },
              { shape: "badge", label: "Open", actionId: "metrics.open" },
              { shape: "script", body: "x" },
            ],
          },
        ],
      });
    });
    expect(view.container.textContent).toContain("50%");
    expect(view.container.textContent).not.toContain("none yet");

    fireEvent.click(view.container.querySelector("button")!);
    expect(call).toHaveBeenCalledWith("dataSlot.action", id, "metrics.open");

    view.unmount();
    expect(call).toHaveBeenCalledWith("dataSlot.unwatch", id);
  });

  it("ignores values for a watch it doesn't have", () => {
    expect(() =>
      receiveDataSlot({ id: "nope", values: [{ parts: [] }] }),
    ).not.toThrow();
    expect(() => receiveDataSlot(null)).not.toThrow();
  });
});
