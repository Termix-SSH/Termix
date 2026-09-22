// The fallback list, for a server older than GET /sync/entity-types.
//
// Current servers return the entity types and their order, which is the only
// way this process learns about one a plugin added. This array is what those
// servers would have synced anyway, so an old pairing keeps working.
const SYNCED_ENTITY_TYPES = Object.freeze([
  // Ordered by reference dependency: hosts and snippets resolve credential,
  // vault and folder syncIds, so those have to exist on the other side first.
  "sshCredentials",
  "vaultProfiles",
  "sshFolders",
  "snippetFolders",
  "hosts",
  "snippets",
  "dashboardServiceLinks",
  "homepageItems",
  "userPreferences",
  // networkTopology stores host references by their local numeric id inside
  // the topology JSON, so it must sync after hosts have been reconciled.
  "networkTopology",
]);

module.exports = { SYNCED_ENTITY_TYPES };
