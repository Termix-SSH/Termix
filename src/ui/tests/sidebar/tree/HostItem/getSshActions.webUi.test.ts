import { describe, expect, it } from "vitest";
import { getSshActions } from "@/sidebar/tree/HostItem/HostItem";
import type { Host } from "@/types/ui-types";
import type { WebEndpoint } from "@/types/index";

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "direct",
    render: "embedded",
    ...overrides,
  };
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "7",
    ip: "10.0.0.5",
    name: "nas",
    enableSsh: false,
    enableWebUi: false,
    ...overrides,
  } as unknown as Host;
}

const webActions = (h: Host) =>
  getSshActions(h).filter((action) => action.type === "web-endpoint");

describe("the sidebar Web UI entry", () => {
  it("is absent when the feature is off, even with endpoints configured", () => {
    expect(
      webActions(
        host({ enableWebUi: false, webUiConfig: { endpoints: [endpoint()] } }),
      ),
    ).toHaveLength(0);
  });

  it("is absent when enabled but no endpoints exist", () => {
    expect(
      webActions(host({ enableWebUi: true, webUiConfig: { endpoints: [] } })),
    ).toHaveLength(0);
  });

  it("appears without SSH, unlike every other entry", () => {
    // A direct endpoint needs no SSH at all; SSH matters only per-endpoint,
    // for tunnel access, which the open route enforces.
    const actions = getSshActions(
      host({
        enableSsh: false,
        enableWebUi: true,
        webUiConfig: { endpoints: [endpoint()] },
      }),
    );
    expect(actions.filter((a) => a.type === "web-endpoint")).toHaveLength(1);
    expect(actions.filter((a) => a.type === "terminal")).toHaveLength(0);
  });

  it("is ONE entry carrying the label and id when there is a single endpoint", () => {
    const [action] = webActions(
      host({
        enableWebUi: true,
        webUiConfig: { endpoints: [endpoint({ label: "Proxmox" })] },
      }),
    );
    expect(action.label).toBe("Proxmox");
    expect(action.endpointId).toBe("e1");
  });

  it("is still ONE entry, with no id, when there are several", () => {
    // A host may declare up to 16; a row of 16 identical globes is unusable.
    // No endpointId is what makes the click surface a picker instead.
    const endpoints = Array.from({ length: 16 }, (_, i) =>
      endpoint({ id: `e${i}`, label: `Endpoint ${i}` }),
    );
    const actions = webActions(
      host({ enableWebUi: true, webUiConfig: { endpoints } }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].endpointId).toBeUndefined();
    expect(actions[0].label).toBe("Web UI");
  });

  it("comes last, after the SSH connection actions", () => {
    const actions = getSshActions(
      host({
        enableSsh: true,
        enableTerminal: true,
        enableWebUi: true,
        webUiConfig: { endpoints: [endpoint()] },
      } as Partial<Host>),
    );
    expect(actions[actions.length - 1].type).toBe("web-endpoint");
  });
});
