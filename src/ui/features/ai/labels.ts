/**
 * Turns the internal identifiers the assistant works in into text a user can
 * read. Tool names, proposal kinds and payload keys all surface in the panel,
 * and raw ids like "propose_create_alert_rule" or "thresholddurationseconds"
 * are not something to show anyone.
 */

/** What each tool is doing, phrased as an action rather than a function name. */
const TOOL_LABELS: Record<string, string> = {
  list_hosts: "Reading hosts",
  get_host: "Reading host",
  list_fleets: "Reading fleets",
  list_snippets: "Reading snippets",
  list_automations: "Reading automations",
  get_automation: "Reading automation",
  list_workspaces: "Reading workspaces",
  list_alert_rules: "Reading alert rules",
  list_notification_channels: "Reading notification channels",
  get_alert_firings: "Reading recent alerts",
  list_homepage_items: "Reading homepage items",
  get_command_history: "Reading command history",
  get_network_topology: "Reading network topology",
  propose_create_host: "Add host",
  propose_update_host: "Update host",
  propose_delete_host: "Delete host",
  propose_create_snippet: "Create snippet",
  propose_update_snippet: "Update snippet",
  propose_delete_snippet: "Delete snippet",
  propose_create_automation: "Create automation",
  propose_create_fleet: "Create fleet",
  propose_create_alert_rule: "Create alert rule",
  propose_run_command: "Run command",
};

/** Readable names for the payload keys the propose tools emit. */
const FIELD_LABELS: Record<string, string> = {
  hostId: "Host",
  hostIds: "Hosts",
  snippetId: "Snippet",
  automationId: "Automation",
  name: "Name",
  ip: "Address",
  port: "Port",
  username: "Username",
  folder: "Folder",
  tags: "Tags",
  content: "Command",
  description: "Description",
  definition: "Definition",
  enabled: "Enabled",
  triggerType: "Trigger",
  thresholdValue: "Threshold",
  thresholdDurationSeconds: "Duration (seconds)",
  cooldownMinutes: "Cooldown (minutes)",
};

const MENTION_LABELS: Record<string, string> = {
  host: "Host",
  snippet: "Snippet",
  automation: "Automation",
};

/**
 * Splits snake_case and camelCase into words and capitalises the first.
 * Used whenever an identifier has no explicit label, so something added later
 * still reads as words rather than one run-on token.
 */
export function humanize(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? humanize(name);
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanize(key);
}

export function mentionLabel(kind: string): string {
  return MENTION_LABELS[kind] ?? humanize(kind);
}
