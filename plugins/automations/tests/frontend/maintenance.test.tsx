import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import * as plugin from "../../src/frontend/index";
import manifest from "../../manifest.json";
import locales from "../../locales/en.json";
import { emptyMaintenance, type HostMaintenance } from "../../src/maintenance";
import { createMaintenanceStore } from "../../src/frontend/maintenance-store";

let rendered: RenderedPluginApp | undefined;
afterEach(async () => {
  await rendered?.deactivate();
  rendered = undefined;
  vi.restoreAllMocks();
});
const active: HostMaintenance = {
  plans: [],
  active: {
    startedAt: "2026-01-01T12:00Z",
    estimatedEnd: "2026-01-01T13:00Z",
    reasons: ["OS upgrade"],
    graceMinutes: 20,
    notifyOverdue: true,
    notified: false,
  },
};
const host = { id: 7, name: "Database", ip: "10.0.0.7" };
function apiFor(state: HostMaintenance) {
  return {
    get: vi.fn(async () => ({ data: [{ hostId: 7, state }] })),
    post: vi.fn(async () => ({ data: emptyMaintenance() })),
  };
}
async function render(
  api: ReturnType<typeof apiFor>,
  permissions = ["automations.view", "automations.edit"],
) {
  rendered = await renderWithApp(plugin, {
    manifest: manifest as unknown as PluginManifest,
    locales,
    api: api as unknown as PluginApiClient,
    permissions,
  });
  return within(
    rendered.renderTab("host_maintenance", { host, isVisible: true }),
  );
}

describe("maintenance UI", () => {
  it("shows the reason and estimate and confirms before ending the correct host", async () => {
    const api = apiFor(active);
    const view = await render(api);
    await waitFor(() => expect(view.getByText("OS upgrade")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "End maintenance" }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Confirm end" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/maintenance/7", {
        action: "end",
      }),
    );
  });
  it("offers a read-only view without edit permission", async () => {
    const view = await render(apiFor(active), ["automations.view"]);
    await waitFor(() => expect(view.getByText("OS upgrade")).toBeTruthy());
    expect(view.queryByRole("button", { name: "End maintenance" })).toBeNull();
    expect(view.queryByLabelText("Reason")).toBeNull();
  });
  it("shows a shared host's maintenance read only even with edit permission", async () => {
    const view = await render(apiFor({ ...active, owned: false }));
    await waitFor(() => expect(view.getByText("OS upgrade")).toBeTruthy());
    expect(view.getByText(locales.maintenance.sharedReadOnly)).toBeTruthy();
    expect(view.queryByRole("button", { name: "End maintenance" })).toBeNull();
    expect(view.queryByLabelText("Reason")).toBeNull();
  });
  it("submits a recurring UTC schedule with its grace period", async () => {
    const api = apiFor(emptyMaintenance());
    const view = await render(api);
    await waitFor(() =>
      expect(
        view
          .getByRole("button", { name: "Start now" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(view.getByLabelText("Action"), {
      target: { value: "schedule" },
    });
    fireEvent.change(view.getByLabelText("Reason"), {
      target: { value: "Upgrade" },
    });
    fireEvent.change(view.getByLabelText("First start (UTC)"), {
      target: { value: "2027-01-01T12:00" },
    });
    fireEvent.change(view.getByLabelText("Repeat"), {
      target: { value: "monthly" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add schedule" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/maintenance/7",
        expect.objectContaining({
          action: "schedule",
          start: "2027-01-01T12:00:00.000Z",
          recurrence: "monthly",
          graceMinutes: 20,
        }),
      ),
    );
  });
  it("disables edits when status cannot be loaded", async () => {
    const api = apiFor(active);
    api.get.mockRejectedValue(new Error("offline"));
    const view = await render(api);
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "Could not refresh",
      ),
    );
    expect(
      view.getByRole("button", { name: "Start now" }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it("does not let a stale refresh overwrite an acknowledged edit", async () => {
    let resolve!: (value: unknown) => void;
    const api = {
      get: vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
      post: vi.fn(async () => ({ data: active })),
    };
    const store = createMaintenanceStore(api as unknown as PluginApiClient);
    const request = store.refresh();
    await store.edit(7, { action: "start" });
    resolve({ data: [] });
    await request;
    expect(store.snapshot()[7]).toEqual(active);
    store.dispose();
  });
});
