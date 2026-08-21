import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWithProxy } from "../../utils/proxy-agent.js";

describe("fetchWithProxy", () => {
  const savedProxies = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(savedProxies)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("uses a dispatcher compatible with the selected fetch implementation", async () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    const server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const response = await fetchWithProxy(`http://127.0.0.1:${address.port}`);
      expect(await response.text()).toBe("ok");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
