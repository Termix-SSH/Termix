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
  // Keep desktop preferences local-only. Some deployed Termix servers expose
  // user preferences as a singleton row keyed by user_id, while older sync
  // upsert paths expect numeric ids; skipping this optional entity keeps
  // remote sync compatible without requiring a backend update.
]);

module.exports = { SYNCED_ENTITY_TYPES };
