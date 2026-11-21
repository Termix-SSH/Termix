import { describe, expect, it } from "vitest";
import { describeEnv } from "../../diagnostics/server-info.js";

describe("describeEnv", () => {
  it("shows allowed values and hides the rest", () => {
    const env = describeEnv({
      PORT: "8080",
      LOG_LEVEL: "debug",
      JWT_SECRET: "very-secret",
      DATABASE_URL: "postgres://u:pw@db/termix",
      HTTPS_PROXY: "http://user:pass@proxy:3128",
      TERMIX_SAFE_MODE: "true",
      HOME: "/root",
      MY_OWN_THING: "x",
    });
    expect(env).toEqual({
      DATABASE_URL: "[set]",
      HTTPS_PROXY: "[set]",
      JWT_SECRET: "[set]",
      LOG_LEVEL: "debug",
      PORT: "8080",
      TERMIX_SAFE_MODE: "true",
    });
  });
});
