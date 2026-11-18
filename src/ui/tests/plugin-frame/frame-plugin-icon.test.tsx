import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PluginIcon } from "@/plugin-frame/frame-plugin-icon";
import { iconFileName } from "@/plugin-frame/frame-icons";

describe("frame PluginIcon", () => {
  it("maps Lucide names to their icon files", () => {
    expect(iconFileName("Sparkles")).toBe("sparkles");
    expect(iconFileName("ArrowUpDown")).toBe("arrow-up-down");
    expect(iconFileName("BarChart3")).toBe("bar-chart-3");
  });

  it("loads the named icon on its own", async () => {
    const { container } = render(<PluginIcon name="Sparkles" />);
    await waitFor(() =>
      expect(container.querySelector("svg.lucide-sparkles")).not.toBeNull(),
    );
  });

  it("falls back to the plugin glyph for an unknown name", () => {
    const { container } = render(<PluginIcon name="NoSuchIcon" />);
    expect(container.querySelector("svg.lucide-puzzle")).not.toBeNull();
  });
});
