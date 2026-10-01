/**
 * A program a plugin starts through ctx.process.run gets a small base
 * environment, never the server's own, which holds the JWT secret, database
 * keys and OIDC client secrets.
 */

import { describe, expect, it } from "vitest";
import { baseEnvironment } from "../../../plugins/ctx-process.js";

describe("ctx.process environment", () => {
  it("passes the path, home, temp and proxy through", () => {
    const env = baseEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/termix",
      TMPDIR: "/tmp",
      HTTPS_PROXY: "http://proxy:3128",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/termix",
      TMPDIR: "/tmp",
      HTTPS_PROXY: "http://proxy:3128",
    });
  });

  it("drops the server's secrets", () => {
    const env = baseEnvironment({
      PATH: "/usr/bin",
      JWT_SECRET: "jwt",
      DATABASE_KEY: "db",
      DATABASE_URL: "postgres://user:pass@db/termix",
      OIDC_CLIENT_SECRET: "oidc",
      INTERNAL_AUTH_TOKEN: "internal",
      GUACAMOLE_ENCRYPTION_KEY: "guac",
    });
    expect(Object.keys(env)).toEqual(["PATH"]);
  });
});
