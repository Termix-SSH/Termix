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
]);

module.exports = { SYNCED_ENTITY_TYPES };
