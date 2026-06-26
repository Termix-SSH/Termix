import { databaseLogger } from "../../utils/logger.js";

export const REPOSITORY_ROLLOUT_ENV = "DATABASE_LAYER_REPOSITORY_ROLLOUT";

export const REPOSITORY_ROLLOUT_DOMAINS = [
  "settings",
  "users",
  "sessions",
  "api_keys",
  "trusted_devices",
  "roles",
  "rbac_access",
] as const;

export type RepositoryRolloutDomain =
  (typeof REPOSITORY_ROLLOUT_DOMAINS)[number];

export interface RepositoryRolloutConfig {
  mode: "all" | "none" | "partial";
  enabledDomains: RepositoryRolloutDomain[];
  explicit: boolean;
}

export interface RepositoryRolloutStatus extends RepositoryRolloutConfig {
  envKey: typeof REPOSITORY_ROLLOUT_ENV;
  supportedDomains: RepositoryRolloutDomain[];
  warnings: string[];
}

type EnvLike = Record<string, string | undefined>;

const DOMAIN_ALIASES: Record<string, RepositoryRolloutDomain> = {
  api: "api_keys",
  api_key: "api_keys",
  api_keys: "api_keys",
  apikey: "api_keys",
  apikeys: "api_keys",
  setting: "settings",
  settings: "settings",
  session: "sessions",
  sessions: "sessions",
  trusted_device: "trusted_devices",
  trusted_devices: "trusted_devices",
  trusteddevice: "trusted_devices",
  trusteddevices: "trusted_devices",
  role: "roles",
  roles: "roles",
  rbac: "rbac_access",
  rbac_access: "rbac_access",
  rbacaccess: "rbac_access",
  user: "users",
  users: "users",
};

const DISABLED_VALUES = new Set(["0", "false", "none", "off", "disabled"]);
const ENABLED_VALUES = new Set(["1", "true", "all", "on", "enabled"]);

function parseDomainList(value: string): RepositoryRolloutDomain[] {
  const domains = value
    .split(",")
    .map((part) => part.trim().toLowerCase().replaceAll("-", "_"))
    .filter(Boolean)
    .map((part) => {
      const domain = DOMAIN_ALIASES[part];
      if (!domain) {
        throw new Error(
          `Unsupported ${REPOSITORY_ROLLOUT_ENV} domain '${part}'. Expected one of: ${REPOSITORY_ROLLOUT_DOMAINS.join(", ")}.`,
        );
      }
      return domain;
    });

  return Array.from(new Set(domains));
}

export function parseRepositoryRolloutConfig(
  env: EnvLike = process.env,
): RepositoryRolloutConfig {
  const raw = env[REPOSITORY_ROLLOUT_ENV];
  const normalized = raw?.trim().toLowerCase();

  if (!normalized) {
    return {
      mode: "all",
      enabledDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
      explicit: false,
    };
  }

  if (ENABLED_VALUES.has(normalized)) {
    return {
      mode: "all",
      enabledDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
      explicit: true,
    };
  }

  if (DISABLED_VALUES.has(normalized)) {
    return { mode: "none", enabledDomains: [], explicit: true };
  }

  const enabledDomains = parseDomainList(normalized);
  return {
    mode:
      enabledDomains.length === REPOSITORY_ROLLOUT_DOMAINS.length
        ? "all"
        : "partial",
    enabledDomains,
    explicit: true,
  };
}

export function isRepositoryRolloutDomainEnabled(
  domain: RepositoryRolloutDomain,
  env: EnvLike = process.env,
): boolean {
  return parseRepositoryRolloutConfig(env).enabledDomains.includes(domain);
}

export function getRepositoryRolloutStatus(
  env: EnvLike = process.env,
): RepositoryRolloutStatus {
  const config = parseRepositoryRolloutConfig(env);
  return {
    ...config,
    envKey: REPOSITORY_ROLLOUT_ENV,
    supportedDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
    warnings: getRepositoryRolloutWarnings(config),
  };
}

export function getRepositoryRolloutWarnings(
  config: RepositoryRolloutConfig,
): string[] {
  const warnings: string[] = [];

  if (!config.explicit) {
    warnings.push(
      `${REPOSITORY_ROLLOUT_ENV} is not explicitly set; gray targets should set it so rollout state is visible in deployment config.`,
    );
  }

  if (config.mode === "none") {
    warnings.push(
      "All migrated repository domains are disabled; migrated auth/settings/session paths will fail closed.",
    );
  }

  if (config.mode === "partial") {
    warnings.push(
      `Partial repository rollout enabled for domains: ${config.enabledDomains.join(", ")}.`,
    );
  }

  return warnings;
}

export function assertRepositoryRolloutDomainEnabled(
  domain: RepositoryRolloutDomain,
): void {
  if (isRepositoryRolloutDomainEnabled(domain)) return;

  throw new Error(
    `Repository domain '${domain}' is disabled by ${REPOSITORY_ROLLOUT_ENV}.`,
  );
}

export function logRepositoryRolloutConfig(env: EnvLike = process.env): void {
  const config = getRepositoryRolloutStatus(env);
  databaseLogger.info("Database repository rollout configuration loaded", {
    operation: "repository_rollout_config",
    mode: config.mode,
    enabledDomains: config.enabledDomains,
    explicit: config.explicit,
    envKey: REPOSITORY_ROLLOUT_ENV,
  });

  for (const warning of config.warnings) {
    databaseLogger.warn(warning, {
      operation: "repository_rollout_warning",
      mode: config.mode,
      enabledDomains: config.enabledDomains,
      explicit: config.explicit,
      envKey: REPOSITORY_ROLLOUT_ENV,
    });
  }
}
