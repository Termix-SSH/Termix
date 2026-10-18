import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const linkedServer = require("../../../../electron/linked-server.cjs") as {
  setLinkedServer: (config: unknown) => void;
};

const source = fs.readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const tls = source.slice(
  source.indexOf("const INSECURE_MODE_VALUES"),
  source.indexOf("function httpFetch("),
);

const ORIGIN = "https://termix.example";
const TERMINAL = "wss://termix.example/plugin-ws/ssh-terminal/terminal";

function load(link: Record<string, unknown> | null) {
  linkedServer.setLinkedServer(link);
  const context = vm.createContext({
    URL,
    process: { env: {} },
    linkedServer,
  });
  vm.runInContext(tls, context);
  return context as unknown as {
    isInvalidCertificateAllowedForUrl: (url: string) => boolean;
    getWebSocketOptions: (
      url: string,
      options?: Record<string, unknown>,
    ) => Record<string, unknown>;
  };
}

describe("linked server certificate exception", () => {
  it("covers WebSockets to the linked server", () => {
    const main = load({ origin: ORIGIN, allowInvalidCertificate: true });
    expect(main.isInvalidCertificateAllowedForUrl(TERMINAL)).toBe(true);
    expect(main.getWebSocketOptions(TERMINAL, { headers: {} })).toEqual({
      headers: {},
      rejectUnauthorized: false,
    });
  });

  it.each([
    "ws://termix.example/relay",
    "wss://termix.example:8443/relay",
    "wss://elsewhere.example/relay",
  ])("keeps verifying %s", (url) => {
    const main = load({ origin: ORIGIN, allowInvalidCertificate: true });
    expect(main.isInvalidCertificateAllowedForUrl(url)).toBe(false);
  });

  it("keeps verifying when the link does not allow it", () => {
    const main = load({ origin: ORIGIN, allowInvalidCertificate: false });
    expect(main.getWebSocketOptions(TERMINAL)).toEqual({
      rejectUnauthorized: true,
    });
  });
});
