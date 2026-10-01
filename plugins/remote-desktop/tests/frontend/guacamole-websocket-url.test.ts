import { describe, expect, it } from "vitest";
import { buildGuacamoleWebSocketBaseUrl } from "../../src/frontend/guacamole-websocket-url.js";

const httpsLocation = {
  protocol: "https:",
  host: "termix.example.com",
} as Location;

// The display socket moved off port 30008 to /plugin-ws/remote-desktop/display
// on the main backend, so every case below asserts the same one path. Dev is
// no longer a special case: Vite proxies the backend, so there is nothing to
// point at a separate port.
const ROUTE = "/plugin-ws/remote-desktop/display";

describe("buildGuacamoleWebSocketBaseUrl", () => {
  it("uses the same origin in production web builds", () => {
    expect(
      buildGuacamoleWebSocketBaseUrl({
        isElectronApp: false,
        isEmbeddedApp: false,
        basePath: "",
        location: httpsLocation,
      }),
    ).toBe(`wss://termix.example.com${ROUTE}`);
  });

  it("preserves the runtime base path for proxied web deployments", () => {
    expect(
      buildGuacamoleWebSocketBaseUrl({
        isElectronApp: false,
        isEmbeddedApp: false,
        basePath: "/termix",
        location: httpsLocation,
      }),
    ).toBe(`wss://termix.example.com/termix${ROUTE}`);
  });

  it("targets the embedded backend for electron running locally", () => {
    expect(
      buildGuacamoleWebSocketBaseUrl({
        isElectronApp: true,
        isEmbeddedApp: true,
        basePath: "/termix",
        location: httpsLocation,
      }),
    ).toBe(`ws://127.0.0.1:30001${ROUTE}`);
  });

  it("uses the configured remote server URL for electron remote mode", () => {
    expect(
      buildGuacamoleWebSocketBaseUrl({
        isElectronApp: true,
        isEmbeddedApp: false,
        configuredServerUrl: "https://termix.example.com/termix/",
        basePath: "",
        location: httpsLocation,
      }),
    ).toBe(`wss://termix.example.com/termix${ROUTE}`);
  });
});
