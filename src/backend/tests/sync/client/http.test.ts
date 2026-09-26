import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  normalizeServerUrl,
  RemoteError,
  remoteJson,
  remoteUrl,
  requestHeaders,
} from "../../../sync/client/http.js";

describe("server addresses", () => {
  it("adds https, drops a trailing slash, query and hash, keeps a base path", () => {
    expect(normalizeServerUrl("termix.example.com/")).toBe(
      "https://termix.example.com",
    );
    expect(normalizeServerUrl(" http://10.0.0.5:8080/termix/?x=1#y ")).toBe(
      "http://10.0.0.5:8080/termix",
    );
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("ftp://nope")).toBeNull();
  });

  it("joins paths onto a base path", () => {
    expect(remoteUrl("https://x.example/termix/", "/sync/v2/info")).toBe(
      "https://x.example/termix/sync/v2/info",
    );
  });
});

describe("request headers", () => {
  it("sends the session as a cookie so basic auth can have Authorization", () => {
    const headers = requestHeaders({
      serverUrl: "https://x",
      sessionToken: "tok",
      basicAuth: { username: "u", password: "p" },
      customHeaders: [
        { name: "CF-Access-Client-Id", value: "id" },
        { name: "", value: "ignored" },
      ],
    });
    expect(headers.Cookie).toBe("jwt=tok");
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("u:p").toString("base64")}`,
    );
    expect(headers["CF-Access-Client-Id"]).toBe("id");
    expect(Object.keys(headers)).not.toContain("");
  });
});

describe("classifying answers", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case "/ok":
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ fine: true, cookie: req.headers.cookie }));
          return;
        case "/login-page":
          res.setHeader("Content-Type", "text/html");
          res.end("<html>sign in</html>");
          return;
        case "/basic":
          res.statusCode = 401;
          res.setHeader("WWW-Authenticate", 'Basic realm="proxy"');
          res.end("no");
          return;
        case "/signed-out":
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        default:
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "boom" }));
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const kindOf = async (path: string) => {
    try {
      await remoteJson({ serverUrl: base, sessionToken: "t" }, path);
      return "none";
    } catch (error) {
      return (error as RemoteError).kind;
    }
  };

  it("returns JSON from Termix with the session attached", async () => {
    const body = await remoteJson<{ fine: boolean; cookie: string }>(
      { serverUrl: base, sessionToken: "t" },
      "/ok",
    );
    expect(body).toEqual({ fine: true, cookie: "jwt=t" });
  });

  it("tells a proxy page, basic auth, sign out and server errors apart", async () => {
    expect(await kindOf("/login-page")).toBe("proxy");
    expect(await kindOf("/basic")).toBe("basic_auth");
    expect(await kindOf("/signed-out")).toBe("signed_out");
    expect(await kindOf("/boom")).toBe("server");
  });

  it("calls an unreachable server offline", async () => {
    const error = await remoteJson({ serverUrl: "http://127.0.0.1:1" }, "/x", {
      timeoutMs: 5000,
    }).catch((e) => e);
    expect((error as RemoteError).kind).toBe("offline");
  });
});
