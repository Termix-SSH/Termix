import { beforeAll, describe, expect, it } from "vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import authz from "../../../authz.json";

type Call = { method: string; url: string };
const calls: Call[] = [];
const state = { status: 200 };

// Every request the client makes lands here instead of the network.
axios.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
  const base = config.baseURL ?? "";
  const url = `${base}${config.url ?? ""}`.replace(/^https?:\/\/[^/]+/, "");
  calls.push({ method: (config.method ?? "get").toUpperCase(), url });
  const response = {
    data: {},
    status: state.status,
    statusText: "",
    headers: {},
    config,
  };
  if (state.status >= 400) {
    throw new AxiosError("failed", String(state.status), config, null, {
      ...response,
      data: { error: "nope", code: "X" },
    } as never);
  }
  return response;
};

const mod = (await import("../main-axios")) as Record<string, unknown>;

const routes = Object.keys(authz.routes).map((key) => {
  const [method, path] = key.split(" ");
  const pattern = path
    .split("/")
    .map((p) =>
      p.startsWith(":") ? "[^/]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return { method, regex: new RegExp(`^${pattern}$`) };
});

function served(call: Call): boolean {
  const path = call.url.split("?")[0].replace(/\/+$/, "") || "/";
  return routes.some((r) => r.method === call.method && r.regex.test(path));
}

// Functions that change the page or wait on user input, not API calls.
const SKIP = new Set(["logoutUser", "requestDesktopAutoSession"]);

async function callAll(): Promise<number> {
  let count = 0;
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "function" || SKIP.has(name)) continue;
    if (
      !/^(get|set|create|update|delete|remove|register|admin|login|unlock|initiate|verify|complete|change|request|reset|list|toggle|add|revoke|disable|enable|generate|link|unlink|save|test|start|stop|upload|download|import|export|check|send|refresh|fetch|issue|approve|deny|rename|move|copy|run)/.test(
        name,
      )
    ) {
      continue;
    }
    count++;
    try {
      await Promise.race([
        (value as (...a: unknown[]) => unknown)("x", "y", { id: 1 }, 1),
        new Promise((r) => setTimeout(r, 100)),
      ]);
    } catch {
      // placeholder arguments or the failing fake
    }
  }
  return count;
}

describe("main-axios clients", () => {
  let count = 0;
  beforeAll(async () => {
    count = await callAll();
    state.status = 500;
    await callAll();
    state.status = 200;
  });

  it("calls the API from its functions", () => {
    expect(count).toBeGreaterThan(30);
    expect(calls.length).toBeGreaterThan(30);
  });

  it("only calls routes the server serves", () => {
    const missing = [
      ...new Set(
        calls
          .filter((c) => !c.url.startsWith("/plugin-api/"))
          .filter((c) => !served(c))
          .map((c) => `${c.method} ${c.url}`),
      ),
    ];
    expect(missing).toEqual([]);
  });

  it("turns failed requests into readable errors", () => {
    const handle = mod.handleApiError as (e: unknown, op: string) => never;
    const error = new AxiosError("boom", "ERR", undefined, null, {
      status: 403,
      data: { error: "Admin access required" },
    } as never);
    expect(() => handle(error, "load")).toThrow();
    expect(() => handle(new Error("plain"), "load")).toThrow();
  });
});
