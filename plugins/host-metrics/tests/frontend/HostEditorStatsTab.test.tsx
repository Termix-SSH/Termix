import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HostStatsTab } from "../../src/frontend/HostEditorStatsTab";

afterEach(cleanup);

function renderSection(pluginSettings: Record<string, unknown> = {}) {
  let form: Record<string, unknown> = {
    quickActions: [],
    pluginSettings: { "host-metrics": pluginSettings, other: { keep: 1 } },
  };
  const updateForm = vi.fn(
    (patch: (current: Record<string, unknown>) => Record<string, unknown>) => {
      form = { ...form, ...patch(form) };
    },
  );
  render(
    <HostStatsTab
      form={form}
      setField={vi.fn()}
      updateForm={updateForm as never}
      host={{ id: "7", name: "h", ip: "10.0.0.7", port: 22 }}
      snippets={[]}
      protocols={{ ssh: true }}
    />,
  );
  return { updateForm, form: () => form };
}

describe("HostStatsTab", () => {
  it("writes the plugin's host settings and leaves other plugins alone", () => {
    const { form } = renderSection({ metricsEnabled: true });
    fireEvent.change(
      screen.getByPlaceholderText("hosts.excludedMountsPlaceholder"),
      { target: { value: "/snap" } },
    );
    fireEvent.click(screen.getByText(/hosts.addExcludedMount/));
    expect(form().pluginSettings).toEqual({
      "host-metrics": { metricsEnabled: true, excludedMounts: ["/snap"] },
      other: { keep: 1 },
    });
  });

  it("has no status check options, which are core's", () => {
    renderSection();
    expect(screen.queryByText("hosts.statusChecksLabel")).toBeNull();
  });
});
