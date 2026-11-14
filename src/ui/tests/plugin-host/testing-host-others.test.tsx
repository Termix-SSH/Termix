import { describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import {
  useExtensions,
  usePluginComponent,
} from "@termix-ssh/plugin-sdk/frontend";
import { ComponentSlot } from "@/shell/ActionSlot";
import { renderPlugin } from "@/plugin-host/testing-host";

function Card() {
  return <p>cron card</p>;
}

function Widget() {
  return <p>docker widget</p>;
}

function Terminal() {
  return <p>terminal</p>;
}

function Board() {
  const widgets = useExtensions("board.widgets");
  const View = usePluginComponent("terminal.view");
  return (
    <div>
      <ComponentSlot slotId="board.cards" />
      {widgets.map((widget) => {
        const Part = widget.components!.view;
        return <Part key={widget.id} />;
      })}
      {View && <View />}
    </div>
  );
}

describe("renderWithApp others", () => {
  it("draws other plugins' parts the test supplies, and drops them after", async () => {
    const rendered = await renderPlugin(
      {
        activate: (app: never) => {
          const a = app as {
            registerTab: (...args: unknown[]) => void;
            declareActionSlot: (slot: object) => void;
          };
          a.declareActionSlot({ id: "board.cards", accepts: ["component"] });
          a.registerTab("board", Board, { hostless: true });
        },
      },
      {
        pluginId: "board",
        manifest: { contributes: { tabs: [{ id: "board" }] } as never },
        others: {
          slots: {
            "board.cards": [{ actionId: "cron.card", component: Card }],
          },
          extensions: {
            "board.widgets": [{ id: "docker", components: { view: Widget } }],
          },
          components: { "terminal.view": Terminal },
        },
      },
    );
    const element = rendered.renderTab("board");
    expect(element.textContent).toContain("cron card");
    expect(element.textContent).toContain("docker widget");
    expect(element.textContent).toContain("terminal");
    await act(() => rendered.deactivate());
  });

  it("renderSlot draws a component part once", async () => {
    const rendered = await renderPlugin(
      {
        activate: (app: never) => {
          const a = app as {
            registerSlotContribution: (slot: string, part: object) => void;
          };
          a.registerSlotContribution("test.slot", {
            actionId: "board.card",
            titleKey: "x",
            kind: "component",
            component: Card,
          });
        },
      },
      { pluginId: "board" },
    );
    const element = rendered.renderSlot("test.slot");
    expect(element.textContent).toBe("cron card");
    await act(() => rendered.deactivate());
  });
});
