import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const linked = require("../../../../electron/linked-server.cjs") as {
  setLinkedServer: (config: unknown) => void;
  getLinkedServer: () => Record<string, unknown> | null;
  isLinkedOrigin: (url: string) => boolean;
  applyLinkHeaders: (
    url: string,
    headers: Record<string, string>,
  ) => Record<string, string>;
  linkedRequestHeaders: (
    extra?: Record<string, string>,
  ) => Record<string, string>;
  answerLogin: (
    authInfo: { isProxy?: boolean } | null,
    url: string,
  ) => { username: string; password: string } | null;
};

const ORIGIN = "https://termix.example";

beforeEach(() => {
  linked.setLinkedServer(null);
});

describe("linked server in Electron main", () => {
  it("adds proxy headers only for the linked origin", () => {
    linked.setLinkedServer({
      origin: ORIGIN,
      headers: [{ name: "CF-Access-Client-Id", value: "id" }],
    });
    expect(
      linked.applyLinkHeaders(`${ORIGIN}/sync/v2/info`, { Accept: "x" }),
    ).toEqual({ Accept: "x", "CF-Access-Client-Id": "id" });
    expect(
      linked.applyLinkHeaders("https://elsewhere.example/", { Accept: "x" }),
    ).toEqual({ Accept: "x" });
  });

  it("moves a Termix bearer into the jwt cookie when basic auth is in front", () => {
    linked.setLinkedServer({
      origin: ORIGIN,
      basicAuth: { username: "gate", password: "pw" },
    });
    const headers = linked.applyLinkHeaders(`${ORIGIN}/host/status`, {
      authorization: "Bearer tok",
      Cookie: "a=b",
    });
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("gate:pw").toString("base64")}`,
    );
    expect(headers.authorization).toBeUndefined();
    expect(headers.Cookie).toBe("a=b; jwt=tok");
  });

  it("builds main's own request headers with the session", () => {
    linked.setLinkedServer({ origin: ORIGIN, token: "tok" });
    expect(linked.linkedRequestHeaders()).toEqual({
      "X-Electron-App": "true",
      Authorization: "Bearer tok",
    });
  });

  it("answers basic auth challenges from the linked origin only", () => {
    linked.setLinkedServer({
      origin: ORIGIN,
      basicAuth: { username: "gate", password: "pw" },
    });
    expect(linked.answerLogin({}, `${ORIGIN}/`)).toEqual({
      username: "gate",
      password: "pw",
    });
    expect(linked.answerLogin({ isProxy: true }, `${ORIGIN}/`)).toBeNull();
    expect(linked.answerLogin({}, "https://other.example/")).toBeNull();
  });

  it("forgets everything on unlink", () => {
    linked.setLinkedServer({ origin: ORIGIN, token: "tok" });
    linked.setLinkedServer(null);
    expect(linked.getLinkedServer()).toBeNull();
    expect(linked.isLinkedOrigin(`${ORIGIN}/`)).toBe(false);
  });
});
