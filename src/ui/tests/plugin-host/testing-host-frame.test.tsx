import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import { checkFramePlugin } from "@/plugin-host/testing-host";

const manifest = {
  id: "gizmo",
  name: "Gizmo",
  version: "1.0.0",
  contributes: { tabs: [{ id: "gizmo" }], panels: [] },
};

describe("checkFramePlugin", () => {
  it("reports registrations as the shell would get them", async () => {
    const result = await checkFramePlugin(
      {
        activate: (app: never) => {
          const a = app as {
            registerTab: (...args: unknown[]) => void;
            registerAction: (...args: unknown[]) => void;
          };
          a.registerTab("gizmo", () => null, { icon: Box, titleKey: "t" });
          a.registerAction("gizmo.ping", () => 1);
        },
      },
      { manifest },
    );
    expect(result.problems).toEqual([]);
    expect(result.registrations.map((entry) => entry.kind)).toEqual([
      "tab",
      "action",
    ]);
    expect(result.registrations[0].data).toMatchObject({
      id: "gizmo",
      icon: { $icon: "Box" },
      component: { $component: "tab:gizmo" },
    });
  });

  it("lists what a frame can't carry", async () => {
    const result = await checkFramePlugin(
      {
        activate: (app: never) => {
          const a = app as {
            registerTab: (...args: unknown[]) => void;
            registerLayout: (...args: unknown[]) => void;
          };
          a.registerTab("gizmo", () => null, {
            icon: function Custom() {
              return null;
            },
          });
          a.registerLayout({ id: "x", label: "x", component: () => null });
        },
      },
      { manifest },
    );
    expect(result.problems).toEqual([
      expect.stringContaining("not a lucide-react icon"),
      expect.stringContaining("layouts"),
    ]);
  });
});
