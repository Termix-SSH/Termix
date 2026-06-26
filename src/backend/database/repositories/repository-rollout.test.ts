import { describe, expect, it } from "vitest";
import {
  getRepositoryRolloutStatus,
  isRepositoryRolloutDomainEnabled,
  parseRepositoryRolloutConfig,
  REPOSITORY_ROLLOUT_ENV,
} from "./repository-rollout.js";

describe("parseRepositoryRolloutConfig", () => {
  it("defaults to the current migrated repository slice", () => {
    const config = parseRepositoryRolloutConfig({});

    expect(config).toEqual({
      mode: "all",
      enabledDomains: [
        "settings",
        "users",
        "sessions",
        "api_keys",
        "trusted_devices",
      ],
      explicit: false,
    });
  });

  it("allows explicitly disabling all migrated repository domains", () => {
    const config = parseRepositoryRolloutConfig({
      [REPOSITORY_ROLLOUT_ENV]: "off",
    });

    expect(config).toEqual({
      mode: "none",
      enabledDomains: [],
      explicit: true,
    });
  });

  it("accepts a partial domain allowlist with aliases", () => {
    const config = parseRepositoryRolloutConfig({
      [REPOSITORY_ROLLOUT_ENV]: "settings,user,api-key",
    });

    expect(config).toEqual({
      mode: "partial",
      enabledDomains: ["settings", "users", "api_keys"],
      explicit: true,
    });
  });

  it("deduplicates allowlisted domains", () => {
    const config = parseRepositoryRolloutConfig({
      [REPOSITORY_ROLLOUT_ENV]: "users,user,users",
    });

    expect(config.enabledDomains).toEqual(["users"]);
  });

  it("rejects unknown domains", () => {
    expect(() =>
      parseRepositoryRolloutConfig({
        [REPOSITORY_ROLLOUT_ENV]: "settings,hosts",
      }),
    ).toThrow("Unsupported DATABASE_LAYER_REPOSITORY_ROLLOUT domain");
  });

  it("checks whether an individual domain is enabled", () => {
    const env = { [REPOSITORY_ROLLOUT_ENV]: "sessions" };

    expect(isRepositoryRolloutDomainEnabled("sessions", env)).toBe(true);
    expect(isRepositoryRolloutDomainEnabled("users", env)).toBe(false);
  });

  it("builds a status payload for admin visibility", () => {
    const status = getRepositoryRolloutStatus({
      [REPOSITORY_ROLLOUT_ENV]: "settings,sessions",
    });

    expect(status).toEqual({
      mode: "partial",
      enabledDomains: ["settings", "sessions"],
      explicit: true,
      envKey: REPOSITORY_ROLLOUT_ENV,
      supportedDomains: [
        "settings",
        "users",
        "sessions",
        "api_keys",
        "trusted_devices",
      ],
    });
  });
});
