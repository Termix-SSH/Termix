import { afterEach, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { renderPlugin } from "@/plugin-host/testing-host";
import {
  HostTreeChildren,
  hostTreeChildrenFor,
  hostTreeChildrenReporter,
  listHostTreeChildrenProviders,
  parseHostTreeChildren,
  registerHostTreeChildren,
  resetHostTreeChildren,
  type HostTreeChildrenGroup,
} from "@/shell/host-tree-children";
import type { Host } from "@/types/ui-types";

afterEach(() => resetHostTreeChildren());

const host = {
  id: "4",
  name: "box",
  ip: "10.0.0.4",
  pluginSettings: { docker: { on: true }, other: { secret: "x" } },
} as unknown as Host;

function Groups({ groups }: { groups: HostTreeChildrenGroup[] }) {
  return (
    <ul>
      {groups.flatMap((group) =>
        (group.result?.items ?? []).map((item) => (
          <li key={`${group.providerId}:${item.id}`}>{item.label}</li>
        )),
      )}
    </ul>
  );
}

describe("parseHostTreeChildren", () => {
  it("keeps well formed items and drops the rest", () => {
    const parsed = parseHostTreeChildren({
      items: [
        { id: "a", label: "web", tabType: "docker", kind: "container" },
        { id: "b", label: "", tabType: "docker" },
        {
          id: "c",
          label: "db",
          tabType: "docker",
          kind: "toaster",
          state: "on",
        },
        "junk",
        { label: "no id", tabType: "docker" },
      ],
      loading: true,
    });
    expect(parsed?.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(parsed?.items[1].kind).toBeUndefined();
    expect(parsed?.items[1].state).toBeUndefined();
    expect(parsed?.loading).toBe(true);
  });

  it("returns null for nothing and copies data as plain JSON", () => {
    expect(parseHostTreeChildren(null)).toBeNull();
    const data = { focus: { container: "web" }, fn: () => 1 };
    const parsed = parseHostTreeChildren({
      items: [{ id: "a", label: "web", tabType: "docker", data }],
    });
    expect(parsed?.items[0].data).toEqual({ focus: { container: "web" } });
  });

  it("caps the list length", () => {
    const items = Array.from({ length: 600 }, (_, i) => ({
      id: String(i),
      label: `c${i}`,
      tabType: "docker",
    }));
    expect(parseHostTreeChildren({ items })?.items).toHaveLength(500);
  });
});

describe("hostTreeChildrenFor", () => {
  it("skips a provider whose when throws", () => {
    registerHostTreeChildren({
      id: "bad",
      when: () => {
        throw new Error("boom");
      },
      reporter: () => null,
    });
    registerHostTreeChildren({
      id: "ok",
      when: () => true,
      reporter: () => null,
    });
    expect(
      hostTreeChildrenFor(listHostTreeChildrenProviders(), host).map(
        (provider) => provider.id,
      ),
    ).toEqual(["ok"]);
  });
});

describe("HostTreeChildren", () => {
  it("collects what each provider reports for the host", async () => {
    registerHostTreeChildren({
      id: "docker",
      pluginId: "docker",
      when: () => true,
      reporter: hostTreeChildrenReporter((h) => ({
        items: [{ id: "1", label: `web on ${h.name}`, tabType: "docker" }],
      })),
    });
    registerHostTreeChildren({
      id: "vms",
      pluginId: "vms",
      when: () => false,
      reporter: hostTreeChildrenReporter(() => ({
        items: [{ id: "1", label: "hidden", tabType: "vm" }],
      })),
    });
    const view = render(
      <HostTreeChildren host={host}>
        {(groups) => <Groups groups={groups} />}
      </HostTreeChildren>,
    );
    await waitFor(() => expect(view.container.textContent).toBe("web on box"));
  });

  it("gives an in-page plugin's hook only its own settings", async () => {
    const seen: unknown[] = [];
    await renderPlugin(
      {
        activate(app: TermixApp) {
          app.registerHostTreeChildren({
            id: "containers",
            when: () => true,
            useChildren: (h) => {
              seen.push(h.pluginSettings);
              return {
                items: [{ id: "1", label: "web", tabType: "docker" }],
              };
            },
          });
        },
      },
      { pluginId: "docker" },
    );
    const view = render(
      <HostTreeChildren host={host}>
        {(groups) => <Groups groups={groups} />}
      </HostTreeChildren>,
    );
    await waitFor(() => expect(view.container.textContent).toBe("web"));
    expect(seen.at(-1)).toEqual({ docker: { on: true } });
  });
});
