import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { renderPlugin } from "@/plugin-host/testing-host";
import { DataSlot } from "@/components/data-view/DataSlot";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import {
  declareActionSlot,
  registerAction,
  registerSlotContribution,
  resetActionRegistry,
} from "@/shell/action-registry";
import { dataReporter } from "@/components/data-view/data-reporter";
import { resetHostContributions } from "@/sidebar/host-contributions";

afterEach(() => {
  resetActionRegistry();
  resetHostContributions();
});

const host = {
  id: 4,
  name: "web",
  ip: "10.0.0.4",
  pluginSettings: { metrics: { on: true }, other: { secret: "x" } },
};

describe("DataSlot", () => {
  it("draws an in-page plugin's values for the row and passes its context", async () => {
    const seen: unknown[] = [];
    const rendered = await renderPlugin(
      {
        activate(app: TermixApp) {
          app.registerSlotContribution("dashboard.hostRow", {
            actionId: "metrics.row",
            titleKey: "row",
            kind: "data",
            useValue: (context, rowKey) => {
              seen.push([context, rowKey]);
              return {
                shape: "bars",
                items: [{ label: "CPU", value: Number(rowKey) / 10 }],
              };
            },
          });
        },
      },
      { pluginId: "metrics" },
    );
    const element = rendered.renderSlot("dashboard.hostRow", {
      hostId: 4,
      host,
      online: true,
    });
    await waitFor(() => expect(element.textContent).toContain("40%"));
    const [context, rowKey] = seen.at(-1) as [Record<string, unknown>, string];
    expect(rowKey).toBe("4");
    expect(context.online).toBe(true);
    // Only the plugin's own settings reach its hook.
    expect(
      (context.host as { pluginSettings: Record<string, unknown> })
        .pluginSettings,
    ).toEqual({ metrics: { on: true } });
  });

  it("shows the fallback until a plugin has a value", async () => {
    setPermissionsForTesting([]);
    declareActionSlot({ id: "x.badge", accepts: ["data"], shapes: ["badge"] });
    let value: unknown = null;
    const useValue = () => value;
    registerSlotContribution("x.badge", {
      actionId: "p.badge",
      titleKey: "b",
      kind: "data",
      value: dataReporter(useValue),
      pluginId: "p",
    });
    const view = render(
      <DataSlot slotId="x.badge" rowKey={1} fallback={<span>Online</span>} />,
    );
    await waitFor(() => expect(view.container.textContent).toBe("Online"));
    const slot = view.container.querySelector("[data-data-slot='x.badge']")!;
    expect(slot.querySelector("[data-data-view]")).toBeNull();
    // The slot hides its fallback in CSS once a value drew beside it.
    expect(slot.className).toContain(
      "[&:has([data-data-view])>[data-data-fallback]]:hidden",
    );
    value = { shape: "badge", label: "Failing", tone: "bad" };
    view.rerender(
      <DataSlot
        slotId="x.badge"
        rowKey={1}
        context={{ again: true }}
        fallback={<span>Online</span>}
      />,
    );
    await waitFor(() =>
      expect(slot.querySelector("[data-data-view]")?.textContent).toBe(
        "Failing",
      ),
    );
    expect(slot.querySelector(":scope > [data-data-fallback]")).not.toBeNull();
  });

  it("drops shapes the slot does not draw", async () => {
    setPermissionsForTesting([]);
    declareActionSlot({ id: "x.only", accepts: ["data"], shapes: ["text"] });
    registerSlotContribution("x.only", {
      actionId: "p.v",
      titleKey: "v",
      kind: "data",
      value: dataReporter(() => [
        { shape: "dot", tone: "bad", label: "nope" },
        { shape: "text", text: "yes" },
      ]),
      pluginId: "p",
    });
    const view = render(<DataSlot slotId="x.only" rowKey="a" />);
    await waitFor(() => expect(view.container.textContent).toBe("yes"));
    expect(view.container.querySelector("[data-data-dot]")).toBeNull();
  });

  it("runs a value's action only when it is the sending plugin's own", async () => {
    setPermissionsForTesting([]);
    const own = vi.fn();
    const foreign = vi.fn();
    registerAction("p.open", own, { pluginId: "p" });
    registerAction("q.delete", foreign, { pluginId: "q" });
    declareActionSlot({ id: "x.act", accepts: ["data"] });
    registerSlotContribution("x.act", {
      actionId: "p.v",
      titleKey: "v",
      kind: "data",
      value: dataReporter(() => [
        { shape: "badge", label: "Open", actionId: "p.open" },
        { shape: "badge", label: "Delete", actionId: "q.delete" },
      ]),
      pluginId: "p",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = render(
      <DataSlot slotId="x.act" rowKey="7" context={{ hostId: 7 }} />,
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll("button")).toHaveLength(2),
    );
    const [open, remove] = view.container.querySelectorAll("button");
    await act(async () => {
      fireEvent.click(open);
      fireEvent.click(remove);
    });
    expect(own).toHaveBeenCalledWith({ hostId: 7 });
    expect(foreign).not.toHaveBeenCalled();
  });

  it("still renders a component from a plugin that has not moved to data", async () => {
    setPermissionsForTesting([]);
    declareActionSlot({ id: "x.mixed", accepts: ["data", "component"] });
    registerSlotContribution("x.mixed", {
      actionId: "old.row",
      titleKey: "o",
      kind: "component",
      component: (props) => <span>old {String(props.hostId)}</span>,
    });
    const view = render(
      <DataSlot
        slotId="x.mixed"
        rowKey="3"
        context={{ hostId: 3 }}
        fallback={<span>fb</span>}
      />,
    );
    expect(view.container.textContent).toBe("old 3");
  });
});

describe("HostDataItems", () => {
  it("draws badges, status indicators and toolbar items from values", async () => {
    const rendered = await renderPlugin(
      {
        activate(app: TermixApp) {
          app.registerHostBadge({
            id: "b",
            when: () => true,
            useValue: (h) => ({ shape: "badge", label: `B${h.id}` }),
          });
          app.registerHostStatusIndicator({
            id: "s",
            when: () => true,
            useValue: (h) => ({
              shape: "dot",
              tone: "good",
              label: String(
                (h.pluginSettings as Record<string, unknown> | undefined)
                  ?.other ?? "scoped",
              ),
            }),
          });
          app.registerHostEditorToolbarItem({
            id: "t",
            when: () => true,
            useValue: () => ({ shape: "text", text: "Edit" }),
          });
        },
      },
      { pluginId: "metrics", hosts: [host] },
    );
    const badge = rendered.renderHostItems("badge", host);
    await waitFor(() => expect(badge.textContent).toBe("B4"));
    const status = rendered.renderHostItems("status", host);
    await waitFor(() =>
      expect(
        status.querySelector("[data-data-dot='good']")?.getAttribute("title"),
      ).toBe("scoped"),
    );
    const toolbar = rendered.renderHostItems("toolbar", host);
    await waitFor(() => expect(toolbar.textContent).toBe("Edit"));
  });

  it("reads a slot's values for tests", async () => {
    const rendered = await renderPlugin(
      {
        activate(app: TermixApp) {
          app.registerSlotContribution("terminal.toolbarStatus", {
            actionId: "metrics.status",
            titleKey: "s",
            kind: "data",
            useValue: (context) =>
              context.active ? { shape: "text", text: "live" } : null,
          });
        },
      },
      { pluginId: "metrics" },
    );
    const live = rendered.readDataValues(
      "terminal.toolbarStatus",
      { active: true },
      "tab-1",
    );
    await waitFor(() =>
      expect(live.values()["metrics.status"]).toEqual([
        { shape: "text", text: "live" },
      ]),
    );
    const idle = rendered.readDataValues("terminal.toolbarStatus", {
      active: false,
    });
    await waitFor(() => expect(idle.values()["metrics.status"]).toBeNull());
  });
});
