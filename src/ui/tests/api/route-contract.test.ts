import { beforeAll, describe, expect, it, vi } from "vitest";
import authz from "../../../../authz.json";

type Call = { method: string; url: string; module: string };

const calls: Call[] = [];
const state = { module: "", fail: false };

function fakeApi(prefix: string) {
  const record =
    (method: string) =>
    async (url: string): Promise<{ data: unknown }> => {
      calls.push({ method, url: prefix + url, module: state.module });
      if (state.fail) throw new Error("request failed");
      return { data: {} };
    };
  return {
    defaults: { baseURL: prefix },
    get: record("GET"),
    delete: record("DELETE"),
    post: record("POST"),
    put: record("PUT"),
    patch: record("PATCH"),
    request: async (config: { method?: string; url: string }) =>
      record((config.method ?? "get").toUpperCase())(config.url),
  };
}

// Built without the real module: main-axios re-exports the api files, so
// loading it here would bind them to the real HTTP clients first.
vi.mock("@/main-axios", () => {
  const host = fakeApi("/host");
  const root = fakeApi("");
  return {
    hostApi: host,
    sshHostApi: host,
    authApi: root,
    rbacApi: root,
    getRemoteCoreApi: () => root,
    createRemoteOriginApiInstance: (path: string) => fakeApi(path),
    isElectron: () => false,
    markUserAuthenticated: () => {},
    TRUST_TOKEN_KEY: "termixTrustToken",
    handleApiError: (error: unknown) => {
      throw error;
    },
  };
});

vi.mock("@/lib/remote-server-api", () => ({
  getConnectedRemoteApi: async () => null,
  resolveRemoteHostId: async () => 1,
}));

const modules = import.meta.glob("../../api/*.ts");

const routes = Object.keys(authz.routes).map((key) => {
  const [method, path] = key.split(" ");
  const pattern = path
    .split("/")
    .map((part) =>
      part.startsWith(":")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return { method, regex: new RegExp(`^${pattern}$`) };
});

function served(call: Call): boolean {
  const path = call.url.split("?")[0].replace(/\/+$/, "") || "/";
  return routes.some((r) => r.method === call.method && r.regex.test(path));
}

const ARGS = [1, { id: 1, name: "x" }, { id: 1 }, "x", 1];

async function callEverything(fail: boolean): Promise<number> {
  state.fail = fail;
  let functions = 0;
  for (const [file, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    state.module = file;
    for (const value of Object.values(mod)) {
      if (typeof value !== "function") continue;
      functions++;
      try {
        await Promise.race([
          (value as (...args: unknown[]) => unknown)(...ARGS),
          new Promise((resolve) => setTimeout(resolve, 200)),
        ]);
      } catch {
        // Bad placeholder data or the failing fake; only the request matters.
      }
    }
  }
  return functions;
}

describe("UI API clients", () => {
  let functions = 0;

  beforeAll(async () => {
    functions = await callEverything(false);
    await callEverything(true);
  });

  it("calls every client function", () => {
    expect(functions).toBeGreaterThan(100);
    expect(calls.length).toBeGreaterThan(100);
  });

  it("only calls routes the server serves", () => {
    const core = calls.filter((c) => !c.url.startsWith("/plugin-api/"));
    const missing = [
      ...new Set(
        core.filter((c) => !served(c)).map((c) => `${c.method} ${c.url}`),
      ),
    ];
    expect(missing).toEqual([]);
  });
});
