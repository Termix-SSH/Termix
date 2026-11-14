import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PluginMemoryCell, PluginMemorySummary } from "@/plugins/PluginMemory";
import { formatMb } from "@/plugins/plugin-memory";
import type { PluginProcessReport } from "@/api/plugins-api";

const report = (low: boolean): PluginProcessReport => ({
  core: { rssMb: 250 },
  plugins: [
    { pluginId: "docker", state: "ready", keepOnReason: null, rssMb: 61 },
    { pluginId: "notes", state: "stopped", keepOnReason: null, rssMb: null },
    {
      pluginId: "sso",
      state: "ready",
      keepOnReason: "auth:provide",
      rssMb: 48,
    },
  ],
  totalMb: 359,
  pluginsMb: 109,
  running: 2,
  limitMb: 2048,
  limitSource: "container",
  low,
});

describe("plugin memory", () => {
  it("shows the total and warns only when memory is low", () => {
    const { rerender } = render(<PluginMemorySummary report={report(false)} />);
    expect(screen.getByTestId("plugin-memory").textContent).toContain(
      "plugins.manager.memory.summary",
    );
    expect(screen.queryByText("plugins.manager.memory.lowTitle")).toBeNull();
    rerender(<PluginMemorySummary report={report(true)} />);
    expect(screen.getByText("plugins.manager.memory.lowTitle")).toBeTruthy();
  });

  it("shows MB for running plugins and idle for stopped ones", () => {
    render(
      <>
        <PluginMemoryCell report={report(false)} pluginId="docker" />
        <PluginMemoryCell report={report(false)} pluginId="notes" />
        <PluginMemoryCell report={report(false)} pluginId="missing" />
      </>,
    );
    expect(screen.getByText("61 MB")).toBeTruthy();
    expect(screen.getByText("plugins.manager.memory.idle")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("formats large figures in GB", () => {
    expect(formatMb(512)).toBe("512 MB");
    expect(formatMb(3584)).toBe("3.5 GB");
  });
});
