import { afterEach, describe, expect, it } from "vitest";
import {
  awaitSshAuthProvider,
  registerSshAuthProvider,
  setSshAuthTypeOwnerSource,
} from "../../../hosts/connect/auth-provider-registry.js";
import {
  awaitSecretResolver,
  registerSecretResolver,
  setSecretResolverOwnerSource,
} from "../../../hosts/connect/secret-resolver-registry.js";
import { setPluginStartupWaiter } from "../../../hosts/connect/plugin-startup.js";
import type { SshAuthProvider } from "../../../hosts/connect/types.js";

const owner = { pluginId: "demo-auth", pluginName: "Demo Auth" };

afterEach(() => {
  setPluginStartupWaiter(async () => {});
  setSshAuthTypeOwnerSource(() => []);
  setSecretResolverOwnerSource(() => []);
});

describe("waiting for a plugin that is still starting", () => {
  it("finds an auth provider its plugin registers while starting", async () => {
    setSshAuthTypeOwnerSource(() => [{ ...owner, type: "demo" }]);
    let dispose = () => {};
    setPluginStartupWaiter(async (pluginId) => {
      expect(pluginId).toBe("demo-auth");
      dispose = registerSshAuthProvider({
        type: "demo",
        pluginId: "demo-auth",
      } as unknown as SshAuthProvider);
    });
    const provider = await awaitSshAuthProvider("demo");
    expect(provider.type).toBe("demo");
    dispose();
  });

  it("still names the plugin when it never comes up", async () => {
    setSshAuthTypeOwnerSource(() => [{ ...owner, type: "demo" }]);
    await expect(awaitSshAuthProvider("demo")).rejects.toThrow(
      "This host uses demo, which needs the Demo Auth plugin",
    );
  });

  it("finds a secret resolver its plugin registers while starting", async () => {
    setSecretResolverOwnerSource(() => [{ ...owner, scheme: "demo" }]);
    let dispose = () => {};
    setPluginStartupWaiter(async () => {
      dispose = registerSecretResolver("demo", owner, async () => "secret");
    });
    const resolver = await awaitSecretResolver("demo");
    expect(await resolver.resolve("u1", "demo://x")).toBe("secret");
    dispose();
  });
});
