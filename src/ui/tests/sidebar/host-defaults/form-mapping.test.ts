import { describe, expect, it } from "vitest";
import { createHostEditorForm } from "@/sidebar/HostEditorData";
import {
  applyDefaultToForm,
  changedKeys,
  classifyForm,
  draftOwnKeys,
  formValueForKey,
  ownPluginValues,
  withAllNamespaces,
  withOwnKeys,
  withoutOwnKey,
} from "@/sidebar/host-defaults/form-mapping";

const form = () => createHostEditorForm(null);

describe("host defaults on the editor form", () => {
  it("reads core keys in the API's shape", () => {
    const base = {
      ...form(),
      authType: "credential" as const,
      credentialId: "7",
    };
    expect(formValueForKey(base, "core.auth")).toEqual({
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: false,
      agentSocketPath: null,
      agentIdentity: null,
    });
    expect(formValueForKey(base, "core.sshPort")).toBe(22);
  });

  it("puts a default's value back on the form", () => {
    let next = applyDefaultToForm(form(), "core.socks5", {
      useSocks5: true,
      socks5ProxyChain: [{ host: "a", port: 1080, type: "socks5" }],
    });
    expect(next.useSocks5).toBe(true);
    expect(next.socks5ProxyMode).toBe("chain");
    next = applyDefaultToForm(next, "core.jumpHosts", [{ hostId: 4 }]);
    expect(next.jumpHosts).toEqual([{ hostId: "4" }]);
    next = applyDefaultToForm(next, "term.fontSize", 18);
    expect(next.pluginSettings.term.fontSize).toBe(18);
  });

  it("finds the keys an edit changed", () => {
    const before = form();
    const after = { ...before, sshPort: 2222, keySubTab: "upload" as const };
    expect(
      changedKeys(before, after, ["core.sshPort", "core.auth", "term.x"]),
    ).toEqual(["core.sshPort"]);
  });

  it("classifies what differs from the defaults as the host's own", () => {
    const current = { ...form(), sshPort: 2222 };
    expect(
      classifyForm(
        current,
        {
          "core.sshPort": { value: 22 },
          "core.statusCheckEnabled": { value: true },
        },
        ["core.sshPort", "core.statusCheckEnabled", "core.username"],
      ),
    ).toEqual({ core: ["sshPort", "username"] });
  });

  it("adds and removes own keys", () => {
    const own = withOwnKeys({}, ["core.sshPort", "term.a"]);
    expect(own).toEqual({ core: ["sshPort"], term: ["a"] });
    expect(withoutOwnKey(own, "term.a")).toEqual({
      core: ["sshPort"],
      term: [],
    });
    expect(
      withAllNamespaces(own, new Map([["x.y", { namespace: "x" }]])),
    ).toEqual({ core: ["sshPort"], term: ["a"], x: [] });
  });

  it("sends only the plugin values a host sets itself", () => {
    const keys = new Map<string, unknown>([
      ["term.a", {}],
      ["term.b", {}],
    ]);
    expect(
      ownPluginValues(
        { term: { a: 1, b: 2, enableRdp: true } },
        { term: ["a"] },
        keys,
      ),
    ).toEqual({ term: { a: 1, enableRdp: true } });
    expect(ownPluginValues({ term: { a: 1 } }, null, keys)).toEqual({
      term: { a: 1 },
    });
  });

  it("makes what a plugin's draft filled in the new host's own", () => {
    expect(draftOwnKeys({ port: 2222, username: "u" })).toEqual({
      core: ["sshPort", "username"],
    });
  });
});
