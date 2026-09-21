import { num, objectSchema, proposal, str, type AiTool } from "./types.js";

/**
 * Propose tools never mutate anything. They return a draft that is stored as a
 * pending proposal and rendered as a card; the change happens only when the
 * user approves it, and the payload is re-validated at that point.
 */

export const proposeTools: AiTool[] = [
  {
    name: "propose_create_host",
    description:
      "Propose adding a new SSH host. Never include credentials: the user attaches those themselves after approving.",
    category: "propose",
    parameters: objectSchema(
      {
        name: str("Display name for the host"),
        ip: str("Hostname or IP address"),
        port: num("SSH port (defaults to 22)"),
        username: str("SSH username"),
        folder: str("Folder to file the host under"),
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to apply",
        },
      },
      ["name", "ip"],
    ),
    handler: async (args) =>
      proposal("propose_create_host", `Add host ${String(args.name)}`, {
        name: args.name,
        ip: args.ip,
        port: args.port ?? 22,
        username: args.username ?? null,
        folder: args.folder ?? null,
        tags: args.tags ?? [],
      }),
  },
  {
    name: "propose_update_host",
    description:
      "Propose changing an existing host's non-secret settings. Only include the fields that should change.",
    category: "propose",
    parameters: objectSchema(
      {
        hostId: num("The host id to update"),
        name: str("New display name"),
        ip: str("New hostname or IP address"),
        port: num("New SSH port"),
        username: str("New SSH username"),
        folder: str("New folder"),
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Replacement tag list",
        },
      },
      ["hostId"],
    ),
    handler: async (args) => {
      const changes: Record<string, unknown> = {};
      for (const field of [
        "name",
        "ip",
        "port",
        "username",
        "folder",
        "tags",
      ]) {
        if (args[field] !== undefined) changes[field] = args[field];
      }
      return proposal(
        "propose_update_host",
        `Update host ${String(args.hostId)}`,
        { hostId: args.hostId, changes },
      );
    },
  },
  {
    name: "propose_delete_host",
    description:
      "Propose removing a host. Use sparingly and explain why in the reason.",
    category: "propose",
    parameters: objectSchema(
      {
        hostId: num("The host id to delete"),
        reason: str("Why this host should be removed"),
      },
      ["hostId", "reason"],
    ),
    handler: async (args) =>
      proposal("propose_delete_host", `Delete host ${String(args.hostId)}`, {
        hostId: args.hostId,
        reason: args.reason,
      }),
  },
  {
    name: "propose_create_snippet",
    description:
      "Propose saving a new command snippet the user can run against their hosts.",
    category: "propose",
    parameters: objectSchema(
      {
        name: str("Snippet name"),
        content: str("The command text"),
        description: str("What the snippet does"),
        folder: str("Folder to file it under"),
      },
      ["name", "content"],
    ),
    handler: async (args) =>
      proposal(
        "propose_create_snippet",
        `Create snippet ${String(args.name)}`,
        {
          name: args.name,
          content: args.content,
          description: args.description ?? null,
          folder: args.folder ?? null,
        },
      ),
  },
  {
    name: "propose_update_snippet",
    description: "Propose editing an existing snippet.",
    category: "propose",
    parameters: objectSchema(
      {
        snippetId: num("The snippet id to update"),
        name: str("New name"),
        content: str("New command text"),
        description: str("New description"),
        folder: str("New folder"),
      },
      ["snippetId"],
    ),
    handler: async (args) => {
      const changes: Record<string, unknown> = {};
      for (const field of ["name", "content", "description", "folder"]) {
        if (args[field] !== undefined) changes[field] = args[field];
      }
      return proposal(
        "propose_update_snippet",
        `Update snippet ${String(args.snippetId)}`,
        { snippetId: args.snippetId, changes },
      );
    },
  },
  {
    name: "propose_delete_snippet",
    description: "Propose deleting a snippet.",
    category: "propose",
    parameters: objectSchema(
      {
        snippetId: num("The snippet id to delete"),
        reason: str("Why this snippet should be removed"),
      },
      ["snippetId", "reason"],
    ),
    handler: async (args) =>
      proposal(
        "propose_delete_snippet",
        `Delete snippet ${String(args.snippetId)}`,
        { snippetId: args.snippetId, reason: args.reason },
      ),
  },
  {
    name: "propose_create_automation",
    description:
      "Propose a new automation. The definition must be a valid AutomationDefinition object with a trigger and an ordered list of steps. It is validated server-side and previewed with a dry run before anything happens.",
    category: "propose",
    parameters: objectSchema(
      {
        name: str("Automation name"),
        description: str("What the automation does"),
        definition: {
          type: "object",
          description:
            "The AutomationDefinition: { trigger: {...}, steps: [...] }",
        },
      },
      ["name", "definition"],
    ),
    handler: async (args) =>
      proposal(
        "propose_create_automation",
        `Create automation ${String(args.name)}`,
        {
          name: args.name,
          description: args.description ?? null,
          definition: args.definition,
        },
      ),
  },
  {
    name: "propose_create_fleet",
    description: "Propose grouping hosts into a new fleet.",
    category: "propose",
    parameters: objectSchema(
      {
        name: str("Fleet name"),
        description: str("What this fleet is for"),
        hostIds: {
          type: "array",
          items: { type: "number" },
          description: "Host ids to add as members",
        },
      },
      ["name"],
    ),
    handler: async (args) =>
      proposal("propose_create_fleet", `Create fleet ${String(args.name)}`, {
        name: args.name,
        description: args.description ?? null,
        hostIds: args.hostIds ?? [],
      }),
  },
  {
    name: "propose_create_alert_rule",
    description:
      "Propose a new alert rule that fires when a host metric crosses a threshold.",
    category: "propose",
    parameters: objectSchema(
      {
        name: str("Rule name"),
        hostId: num("Host id to watch, or omit to watch all hosts"),
        triggerType: str(
          "What to watch, for example cpu, memory, disk or host_status",
        ),
        thresholdValue: num("Threshold to compare against"),
        thresholdDurationSeconds: num(
          "How long the breach must persist before firing",
        ),
        cooldownMinutes: num("Minimum minutes between repeat firings"),
      },
      ["name", "triggerType"],
    ),
    handler: async (args) =>
      proposal(
        "propose_create_alert_rule",
        `Create alert rule ${String(args.name)}`,
        {
          name: args.name,
          hostId: args.hostId ?? null,
          triggerType: args.triggerType,
          thresholdValue: args.thresholdValue ?? null,
          thresholdDurationSeconds: args.thresholdDurationSeconds ?? null,
          cooldownMinutes: args.cooldownMinutes ?? 15,
        },
      ),
  },
  {
    name: "propose_run_command",
    description:
      "Propose running a command on a host. The user reviews and approves it before it runs. Use this for anything that changes state; read-only diagnostics may run directly if the user has enabled that.",
    category: "propose",
    parameters: objectSchema(
      {
        hostId: num("The host id to run on"),
        command: str("The exact command to run"),
        explanation: str("What the command does and why it is needed"),
      },
      ["hostId", "command", "explanation"],
    ),
    handler: async (args) =>
      proposal(
        "propose_run_command",
        // Deliberately short: the card renders the command in its own block,
        // so repeating it here made every card twice as tall as it needed.
        `Run a command on host ${String(args.hostId)}`,
        {
          hostId: args.hostId,
          command: args.command,
          explanation: args.explanation,
        },
      ),
  },
];
