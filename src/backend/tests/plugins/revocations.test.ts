import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const runtime = vi.hoisted(() => ({
  plugins: [] as Array<{ id: string; state: string; [key: string]: unknown }>,
  records: new Map<string, { id: string; state: string }>(),
  deactivated: [] as string[],
  activated: [] as string[],
  alerts: [] as Array<Record<string, unknown>>,
  fetched: new Map<string, unknown>(),
  index: null as unknown,
}));

vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({ loader: { list: () => runtime.plugins } }),
  deactivatePlugin: async (id: string) => {
    runtime.deactivated.push(id);
  },
  activatePlugin: async (id: string) => {
    runtime.activated.push(id);
    const plugin = runtime.plugins.find((p) => p.id === id);
    if (plugin) plugin.state = "active";
  },
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    listAll: async () => [...runtime.records.values()],
    update: async (id: string, patch: { state: string }) => {
      runtime.records.set(id, { ...runtime.records.get(id)!, ...patch });
    },
  }),
}));

vi.mock("../../notify/core-notify.js", () => ({
  sendCoreAlert: async (alert: Record<string, unknown>) => {
    runtime.alerts.push(alert);
  },
}));

vi.mock("../../plugins/registry-index.js", () => ({
  getRegistryUrl: () =>
    "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json",
  communitySource: () => ({
    url: "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/community/index.json",
  }),
  officialSource: () => ({ tier: "official" }),
  fetchRegistryJson: async (url: string) => {
    if (!runtime.fetched.has(url)) throw new Error("offline");
    return runtime.fetched.get(url);
  },
  fetchRegistryIndex: async () => runtime.index,
}));

import {
  RevocationRefused,
  acceptRevocationList,
  applyRevocations,
  fetchRevocations,
  getTrustDir,
  loadStoredRevocations,
  revocationsUrl,
  upgradeLegacySignatures,
} from "../../plugins/revocations.js";
import {
  clearRevocationLists,
  getRevocationList,
} from "../../plugins/revocation-state.js";
import { setTrustRootsForTests } from "../../plugins/trust.js";
import {
  envelopeFor,
  makeCert,
  makeOnlineKey,
  makeRevocations,
  makeRoot,
  rootsFor,
} from "../fixtures/trust-chain.js";
import type { LoadedPlugin } from "../../plugins/loader.js";

const a = makeRoot();
const b = makeRoot();
const OFFICIAL_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/trust/official/revocations.json";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-revocations-"));
  process.env.DATA_DIR = dataDir;
  setTrustRootsForTests(rootsFor([a, b], [makeRoot()]));
  clearRevocationLists();
  runtime.plugins = [];
  runtime.records.clear();
  runtime.deactivated = [];
  runtime.activated = [];
  runtime.alerts = [];
  runtime.fetched.clear();
  runtime.index = null;
});

afterEach(() => {
  setTrustRootsForTests(null);
  clearRevocationLists();
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("revocationsUrl", () => {
  it("sits under trust/ next to each tier's index", async () => {
    expect(await revocationsUrl("official")).toBe(OFFICIAL_URL);
    expect(await revocationsUrl("community")).toBe(
      "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/trust/community/revocations.json",
    );
  });
});

describe("acceptRevocationList", () => {
  it("takes a signed list and then only newer ones", () => {
    expect(
      acceptRevocationList("official", makeRevocations(a, { version: 2 })),
    ).toBe(true);
    expect(getRevocationList("official")?.version).toBe(2);
    expect(() =>
      acceptRevocationList("official", makeRevocations(a, { version: 1 })),
    ).toThrow(/older/);
    expect(
      acceptRevocationList("official", makeRevocations(a, { version: 2 })),
    ).toBe(false);
    expect(
      acceptRevocationList("official", makeRevocations(b, { version: 3 })),
    ).toBe(true);
  });

  it("refuses the same version with other content", () => {
    acceptRevocationList("official", makeRevocations(a, { version: 2 }));
    expect(() =>
      acceptRevocationList(
        "official",
        makeRevocations(a, { version: 2, plugins: [{ id: "x" }] }),
      ),
    ).toThrow(/without a new version/);
  });

  it("refuses an unsigned or wrongly signed list", () => {
    const list = makeRevocations(a, { version: 2 });
    expect(() =>
      acceptRevocationList("official", {
        ...list,
        signed: { ...list.signed, version: 9 },
      }),
    ).toThrow(RevocationRefused);
    expect(() =>
      acceptRevocationList("official", makeRevocations(makeRoot())),
    ).toThrow(RevocationRefused);
  });

  it("keeps a revoked root out for good", () => {
    acceptRevocationList(
      "official",
      makeRevocations(b, { version: 2, keys: [{ keyId: a.key.id }] }),
    );
    expect(() =>
      acceptRevocationList("official", makeRevocations(a, { version: 3 })),
    ).toThrow(RevocationRefused);
    expect(() =>
      acceptRevocationList("official", makeRevocations(b, { version: 3 })),
    ).toThrow(/drops revoked root/);
  });
});

describe("fetchRevocations and loadStoredRevocations", () => {
  it("keeps the last good list on disk and uses it when offline", async () => {
    runtime.fetched.set(
      OFFICIAL_URL,
      makeRevocations(a, { version: 4, plugins: [{ id: "x" }] }),
    );
    expect(await fetchRevocations()).toEqual(["official"]);
    expect(
      fs.existsSync(path.join(getTrustDir(), "revocations-official.json")),
    ).toBe(true);

    clearRevocationLists();
    runtime.fetched.clear();
    expect(await fetchRevocations()).toEqual([]);
    expect(getRevocationList("official")).toBeNull();
    await loadStoredRevocations();
    expect(getRevocationList("official")?.plugins).toEqual([
      { id: "x", reason: undefined },
    ]);
  });

  it("ignores a stored list someone edited on disk", async () => {
    fs.mkdirSync(getTrustDir(), { recursive: true });
    const list = makeRevocations(a, { version: 4 });
    fs.writeFileSync(
      path.join(getTrustDir(), "revocations-official.json"),
      JSON.stringify({
        ...list,
        signed: { ...list.signed, plugins: [{ id: "y" }] },
      }),
    );
    await loadStoredRevocations();
    expect(getRevocationList("official")).toBeNull();
  });
});

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    id: "docker",
    state: "active",
    lastError: null,
    manifest: { id: "docker", name: "Docker", version: "1.2.0" },
    signedTier: "official",
    ...overrides,
  };
}

describe("applyRevocations", () => {
  it("stops a revoked running plugin, records it and tells admins", async () => {
    runtime.plugins = [plugin()];
    runtime.records.set("docker", { id: "docker", state: "enabled" });
    acceptRevocationList(
      "official",
      makeRevocations(a, {
        versions: [{ id: "docker", version: "1.2.0", reason: "bad build" }],
      }),
    );
    expect(await applyRevocations()).toEqual({
      stopped: ["docker"],
      restored: [],
    });
    expect(runtime.deactivated).toEqual(["docker"]);
    expect(runtime.plugins[0].state).toBe("blocked");
    expect(runtime.records.get("docker")?.state).toBe("blocked");
    expect(runtime.alerts).toHaveLength(1);
    expect(runtime.alerts[0]).toMatchObject({
      audience: "admins",
      severity: "critical",
      category: "termix.plugin-revoked",
    });
    expect(String(runtime.alerts[0].body)).toContain("bad build");

    // A second pass with the same list changes nothing and sends nothing.
    await applyRevocations();
    expect(runtime.alerts).toHaveLength(1);
  });

  it("leaves an admin's off switch alone", async () => {
    runtime.plugins = [plugin({ state: "loaded" })];
    runtime.records.set("docker", { id: "docker", state: "disabled" });
    acceptRevocationList(
      "official",
      makeRevocations(a, { plugins: [{ id: "docker" }] }),
    );
    await applyRevocations();
    expect(runtime.records.get("docker")?.state).toBe("disabled");
    expect(runtime.deactivated).toEqual([]);
  });

  it("starts a plugin again once a newer list lifts its revocation", async () => {
    runtime.plugins = [plugin()];
    runtime.records.set("docker", { id: "docker", state: "enabled" });
    acceptRevocationList(
      "official",
      makeRevocations(a, { version: 1, plugins: [{ id: "docker" }] }),
    );
    await applyRevocations();
    acceptRevocationList("official", makeRevocations(a, { version: 2 }));
    expect(await applyRevocations()).toEqual({
      stopped: [],
      restored: ["docker"],
    });
    expect(runtime.activated).toEqual(["docker"]);
    expect(runtime.records.get("docker")?.state).toBe("enabled");
  });

  it("never starts a plugin blocked for another reason", async () => {
    runtime.plugins = [
      plugin({ state: "blocked", lastError: "needs ssh-terminal" }),
    ];
    runtime.records.set("docker", { id: "docker", state: "blocked" });
    await applyRevocations();
    expect(runtime.activated).toEqual([]);
  });
});

describe("upgradeLegacySignatures", () => {
  const online = makeOnlineKey();
  const cert = makeCert(a, online);

  function installed(contents: Buffer) {
    const file = path.join(dataDir, "docker.tmxplug");
    fs.writeFileSync(file, contents);
    fs.writeFileSync(`${file}.sig`, "bGVnYWN5");
    return file;
  }

  function indexFor(
    contents: Buffer,
    envelope = envelopeFor(contents, online, cert),
  ) {
    return {
      plugins: [
        {
          id: "docker",
          versions: [
            {
              version: "1.2.0",
              sha256: crypto
                .createHash("sha256")
                .update(contents)
                .digest("hex"),
              chain: [envelope],
            },
          ],
          prereleases: [],
        },
      ],
    };
  }

  it("swaps a pre-chain .sig for the envelope the index lists for the same file", async () => {
    const contents = Buffer.from("plugin");
    const file = installed(contents);
    runtime.index = indexFor(contents);
    const target = plugin({ artifact: file, signedBy: "ec40e29bcc4986b2" });
    expect(
      await upgradeLegacySignatures([target as unknown as LoadedPlugin]),
    ).toEqual(["docker"]);
    expect(JSON.parse(fs.readFileSync(`${file}.sig`, "utf8")).keyId).toBe(
      online.keyId,
    );
    expect(target.signedBy).toBe(online.keyId);
  });

  it("leaves it alone when the index's file is a different one", async () => {
    const file = installed(Buffer.from("plugin"));
    runtime.index = indexFor(Buffer.from("other build"));
    expect(
      await upgradeLegacySignatures([
        plugin({ artifact: file }) as unknown as LoadedPlugin,
      ]),
    ).toEqual([]);
    expect(fs.readFileSync(`${file}.sig`, "utf8")).toBe("bGVnYWN5");
  });

  it("leaves it alone when the envelope does not check out", async () => {
    const contents = Buffer.from("plugin");
    const file = installed(contents);
    runtime.index = indexFor(
      contents,
      envelopeFor(contents, online, makeCert(makeRoot(), online)),
    );
    expect(
      await upgradeLegacySignatures([
        plugin({ artifact: file }) as unknown as LoadedPlugin,
      ]),
    ).toEqual([]);
  });

  it("skips bundled and custom plugins", async () => {
    expect(
      await upgradeLegacySignatures([
        plugin({ signedTier: undefined }) as unknown as LoadedPlugin,
        plugin({
          artifact: "x",
          signedTier: "custom",
        }) as unknown as LoadedPlugin,
      ]),
    ).toEqual([]);
  });
});
