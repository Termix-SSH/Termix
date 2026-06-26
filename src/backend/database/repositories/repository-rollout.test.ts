import { describe, expect, it } from "vitest";
import {
  getRepositoryRolloutStatus,
  getRepositoryRolloutWarnings,
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
        "roles",
        "rbac_access",
        "sso_providers",
        "audit_logs",
        "user_preferences",
        "open_tabs",
        "dismissed_alerts",
        "homepage_layouts",
        "network_topology",
        "dashboard_service_links",
        "command_history",
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
      [REPOSITORY_ROLLOUT_ENV]:
        "settings,user,api-key,alerts,layout,topology,dashboard-link,history",
    });

    expect(config).toEqual({
      mode: "partial",
      enabledDomains: [
        "settings",
        "users",
        "api_keys",
        "dismissed_alerts",
        "homepage_layouts",
        "network_topology",
        "dashboard_service_links",
        "command_history",
      ],
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
        "roles",
        "rbac_access",
        "sso_providers",
        "audit_logs",
        "user_preferences",
        "open_tabs",
        "dismissed_alerts",
        "homepage_layouts",
        "network_topology",
        "dashboard_service_links",
        "command_history",
      ],
      warnings: [
        "Partial repository rollout enabled for domains: settings, sessions.",
      ],
    });
  });

  it("warns when gray rollout is implicit", () => {
    const warnings = getRepositoryRolloutWarnings(
      parseRepositoryRolloutConfig({}),
    );

    expect(warnings).toEqual([
      "DATABASE_LAYER_REPOSITORY_ROLLOUT is not explicitly set; gray targets should set it so rollout state is visible in deployment config.",
    ]);
  });

  it("warns when migrated repository domains are disabled", () => {
    const warnings = getRepositoryRolloutWarnings(
      parseRepositoryRolloutConfig({ [REPOSITORY_ROLLOUT_ENV]: "off" }),
    );

    expect(warnings).toEqual([
      "All migrated repository domains are disabled; migrated auth/settings/session paths will fail closed.",
    ]);
  });
});
