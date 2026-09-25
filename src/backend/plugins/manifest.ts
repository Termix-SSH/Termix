/**
 * Manifest validation, re-exported from the SDK.
 *
 * The contract lives in @termix/plugin-sdk/manifest so the server, the
 * authoring script and plugin authors all read the same rules. This file used
 * to carry its own copy of the enums and validators, which meant three places
 * had to be edited together and quietly drifted when they were not.
 */

export {
  validateManifest,
  parseManifest,
  SUPPORTED_PLUGIN_API_VERSION,
  SYSTEM_ROLE_NAMES,
  RESERVED_PERMISSION_PREFIXES,
  qualifyPermission,
} from "@termix/plugin-sdk/manifest";

export type {
  PluginManifest,
  PluginAuthor,
  PluginEngine,
  PluginContributions,
  PluginTabContribution,
  PluginActionContribution,
  PluginActionSlot,
  PluginPermissionContribution,
  SystemRoleName,
  PluginServiceProvide,
  PluginServiceRequire,
  PluginSecretProvide,
  PluginSecretRequire,
  HostCapabilityContribution,
  ActionContributionKind,
  ParsedManifest,
} from "@termix/plugin-sdk/manifest";

export type {
  Capability,
  CapabilityInfo,
  CapabilityRisk,
} from "@termix/plugin-sdk/capabilities";
