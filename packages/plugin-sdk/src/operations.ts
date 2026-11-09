/**
 * The operations contract: what a plugin declares it can do, in one shape every
 * surface reads (Automations, Fleets, AI, CLI, Mobile, palette, API, MCP).
 *
 * Declarations are data in the manifest, so a surface can list and describe an
 * action without loading the plugin's code. Handlers are registered at
 * activation with ctx.operations.register and must match a declaration.
 *
 * No Node imports: the frontend, the CLI and Mobile read this file too.
 */

import { coerceSettingValue, validateSettingValue } from "./settings.js";
import type { PluginSettingsField, PluginSettingsOption } from "./manifest.js";

export const OPERATION_RISKS = ["read", "change", "destructive"] as const;
export type OperationRisk = (typeof OPERATION_RISKS)[number];

export const OPERATION_SCOPES = ["host", "resource", "server"] as const;
export type OperationScope = (typeof OPERATION_SCOPES)[number];

export const OPERATION_HOST_ACCESS = [
  "connect",
  "view",
  "edit",
  "manage",
] as const;
export type OperationHostAccess = (typeof OPERATION_HOST_ACCESS)[number];

export const OPERATION_DRY_RUN = ["native", "describe"] as const;
/** native: the handler checks ctx.dryRun. describe: core reports its text. */
export type OperationDryRun = (typeof OPERATION_DRY_RUN)[number];

export const OPERATION_FIELD_TYPES = [
  "boolean",
  "string",
  "number",
  "select",
  "multiselect",
  "secret",
  "textarea",
  "json",
  "resource",
] as const;
export type OperationFieldType = (typeof OPERATION_FIELD_TYPES)[number];

export const OPERATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type OperationSeverity = (typeof OPERATION_SEVERITIES)[number];

export const SIGNAL_KINDS = ["count", "gauge", "status", "list"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_STATUSES = ["ok", "warn", "fail", "unknown"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const RESOURCE_COLUMN_TYPES = [
  "text",
  "status",
  "bytes",
  "percent",
  "time",
  "tags",
] as const;
export type ResourceColumnType = (typeof RESOURCE_COLUMN_TYPES)[number];

/** One input or output of an action. A subset of a settings field, plus rules. */
export interface OperationField {
  key: string;
  type: OperationFieldType;
  labelKey?: string;
  descriptionKey?: string;
  placeholderKey?: string;
  default?: unknown;
  options?: PluginSettingsOption[];
  min?: number;
  max?: number;
  /** Key of a boolean field in the same list that must be on. */
  requires?: string;
  group?: string;
  required?: boolean;
  /** string and textarea only. A regular expression the whole value matches. */
  pattern?: string;
  /** Read action whose rows fill the choices, for a list known only at run time. */
  optionsFrom?: string;
  /** type "resource" only: the resource id whose list fills the picker. */
  resource?: string;
  /** Outputs only: dropped before a run is stored or shown. */
  sensitive?: boolean;
}

export interface OperationWhen {
  /** Host setting values that must match, such as { enableDocker: true }. */
  settings?: Record<string, boolean | string | number>;
  /** Lowercase OS names. A host with no known OS passes. */
  os?: string[];
}

export interface OperationSurfaces {
  /** Offered to the AI assistant. Off unless set. */
  assistant?: boolean;
  /** Offered over MCP. Off unless set. */
  mcp?: boolean;
  /** Set false to keep out of the command palette. */
  palette?: boolean;
  /** Set false to keep out of Automations. */
  automations?: boolean;
  /** Set false to keep out of the phone app. */
  mobile?: boolean;
  /** Set false to keep out of the CLI. */
  cli?: boolean;
}

export interface OperationAction {
  /** `<pluginId>.<name>`. */
  id: string;
  /** Bump when inputs change in a way saved references cannot follow. */
  version?: number;
  titleKey: string;
  descriptionKey?: string;
  icon?: string;
  scope: OperationScope;
  /** Required for scope "resource": the resource this acts on. */
  resource?: string;
  inputs?: OperationField[];
  outputs?: OperationField[];
  risk: OperationRisk;
  /** One of this plugin's own permissions, short or full. */
  permission: string;
  /** Lowest share level. Required for host and resource scopes. */
  hostAccess?: OperationHostAccess;
  dryRun?: OperationDryRun;
  /** A read action of this plugin that proves the result. */
  check?: string;
  /** An action of this plugin that reverses this one. */
  undo?: string;
  /** Safe to run twice, so a rollout may retry it. */
  idempotent?: boolean;
  /** Only one such action per host at a time. */
  exclusive?: boolean;
  timeoutMs?: number;
  when?: OperationWhen;
  surfaces?: OperationSurfaces;
}

export interface OperationEvent {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  severity?: OperationSeverity;
  scope: "host" | "server";
  payload?: OperationField[];
}

export interface ResourceColumn {
  key: string;
  titleKey: string;
  type?: ResourceColumnType;
}

export interface OperationResource {
  id: string;
  titleKey: string;
  icon?: string;
  /** Read action that returns { rows: [...] } for one host. */
  list: string;
  /** Row field that is unique on a host. */
  key: string;
  /** Row field shown as the name. */
  name: string;
  /** Row field holding a status word. */
  status?: string;
  /** Row field holding a link, for auto links on the homepage. */
  url?: string;
  /** Tab type that opens this on a host. */
  tab?: string;
  columns?: ResourceColumn[];
  filters?: string[];
}

export interface OperationSignal {
  id: string;
  titleKey: string;
  /** Read action that returns a SignalResult. */
  read: string;
  scope: "host" | "server";
  kind: SignalKind;
  refreshSec?: number;
  /** Action offered as the fix when this signal is not ok. */
  fix?: string;
}

export interface PluginOperationsContribution {
  actions?: OperationAction[];
  events?: OperationEvent[];
  resources?: OperationResource[];
  signals?: OperationSignal[];
  /**
   * Actions this plugin may run through ctx.operations.invoke: exact ids,
   * `<pluginId>.*`, or `*`.
   */
  invokes?: string[];
}

/** What a signal's read action returns. */
export interface SignalResult {
  value?: number | string | null;
  status: SignalStatus;
  label?: string;
  items?: { label: string; status?: SignalStatus }[];
  link?: { tab?: string; data?: Record<string, unknown> };
}

/** What a resource's list action returns. */
export interface ResourceListResult {
  rows: Record<string, unknown>[];
}

/** What a handler returns. */
export interface OperationResult {
  /** One plain line for history and per host results. */
  summary: string;
  /** Whether anything actually changed. */
  changed?: boolean;
  data?: unknown;
  /** Input for the `undo` action that reverses this exact run. */
  undoInput?: Record<string, unknown>;
}

export const OPERATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;

const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const INVOKE_PATTERN = /^(\*|[a-z0-9][a-z0-9-]*\.(\*|[a-z0-9][a-z0-9-]*))$/;

export const MAX_OPERATION_TIMEOUT_MS = 3_600_000;
export const REDACTED_VALUE = "[redacted]";

const ALLOWED_OPERATIONS = [
  "actions",
  "events",
  "resources",
  "signals",
  "invokes",
];
const ALLOWED_ACTION = [
  "id",
  "version",
  "titleKey",
  "descriptionKey",
  "icon",
  "scope",
  "resource",
  "inputs",
  "outputs",
  "risk",
  "permission",
  "hostAccess",
  "dryRun",
  "check",
  "undo",
  "idempotent",
  "exclusive",
  "timeoutMs",
  "when",
  "surfaces",
];
const ALLOWED_FIELD = [
  "key",
  "type",
  "labelKey",
  "descriptionKey",
  "placeholderKey",
  "default",
  "options",
  "min",
  "max",
  "requires",
  "group",
  "required",
  "pattern",
  "optionsFrom",
  "resource",
  "sensitive",
];
const ALLOWED_EVENT = [
  "id",
  "titleKey",
  "descriptionKey",
  "severity",
  "scope",
  "payload",
];
const ALLOWED_RESOURCE = [
  "id",
  "titleKey",
  "icon",
  "list",
  "key",
  "name",
  "status",
  "url",
  "tab",
  "columns",
  "filters",
];
const ALLOWED_SIGNAL = [
  "id",
  "titleKey",
  "read",
  "scope",
  "kind",
  "refreshSec",
  "fix",
];
const ALLOWED_SURFACES = [
  "assistant",
  "mcp",
  "palette",
  "automations",
  "mobile",
  "cli",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  raw: Record<string, unknown>,
  allowed: string[],
  where: string,
  errors: string[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key))
      errors.push(`Unknown field "${key}" in ${where}`);
  }
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  where: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${where} must be one of: ${allowed.join(", ")}`);
  }
}

function requireText(value: unknown, where: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${where} must be a non-empty string`);
  }
}

function optionalText(value: unknown, where: string, errors: string[]): void {
  if (value !== undefined) requireText(value, where, errors);
}

function optionalBoolean(
  value: unknown,
  where: string,
  errors: string[],
): void {
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(`${where} must be a boolean`);
  }
}

function requireId(
  value: unknown,
  pluginId: string | undefined,
  where: string,
  seen: Set<string>,
  errors: string[],
): void {
  if (typeof value !== "string" || !OPERATION_ID_PATTERN.test(value)) {
    errors.push(`${where}.id must look like "<pluginId>.<name>" in lowercase`);
    return;
  }
  if (pluginId && !value.startsWith(`${pluginId}.`)) {
    errors.push(`${where}.id must start with "${pluginId}."`);
  }
  if (seen.has(value)) errors.push(`${where}.id "${value}" is declared twice`);
  seen.add(value);
}

function eachObject(
  value: unknown,
  where: string,
  errors: string[],
  each: (raw: Record<string, unknown>, at: string) => void,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${where} must be an array`);
    return;
  }
  value.forEach((raw, index) => {
    const at = `${where}[${index}]`;
    if (!isObject(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    each(raw, at);
  });
}

function validateFields(value: unknown, where: string, errors: string[]): void {
  const keys = new Set<string>();
  eachObject(value, where, errors, (raw, at) => {
    rejectUnknown(raw, ALLOWED_FIELD, at, errors);
    if (typeof raw.key !== "string" || !FIELD_KEY_PATTERN.test(raw.key)) {
      errors.push(`${at}.key must be a short name starting with a letter`);
    } else if (keys.has(raw.key)) {
      errors.push(`${at}.key "${raw.key}" is declared twice`);
    } else {
      keys.add(raw.key);
    }
    requireEnum(raw.type, OPERATION_FIELD_TYPES, `${at}.type`, errors);
    optionalText(raw.labelKey, `${at}.labelKey`, errors);
    optionalText(raw.descriptionKey, `${at}.descriptionKey`, errors);
    optionalText(raw.placeholderKey, `${at}.placeholderKey`, errors);
    optionalText(raw.group, `${at}.group`, errors);
    optionalText(raw.requires, `${at}.requires`, errors);
    optionalText(raw.optionsFrom, `${at}.optionsFrom`, errors);
    optionalBoolean(raw.required, `${at}.required`, errors);
    optionalBoolean(raw.sensitive, `${at}.sensitive`, errors);
    if (raw.type === "resource" && typeof raw.resource !== "string") {
      errors.push(`${at}.resource is required for type "resource"`);
    }
    if (raw.resource !== undefined && raw.type !== "resource") {
      errors.push(`${at}.resource needs type "resource"`);
    }
    if (raw.type === "secret" && raw.default !== undefined) {
      errors.push(`${at}.default is not allowed on a secret`);
    }
    if (
      (raw.type === "select" || raw.type === "multiselect") &&
      !raw.optionsFrom &&
      (!Array.isArray(raw.options) || raw.options.length === 0)
    ) {
      errors.push(`${at} needs options or optionsFrom`);
    }
    for (const bound of ["min", "max"] as const) {
      if (raw[bound] !== undefined && typeof raw[bound] !== "number") {
        errors.push(`${at}.${bound} must be a number`);
      }
    }
    if (raw.pattern !== undefined) {
      if (typeof raw.pattern !== "string") {
        errors.push(`${at}.pattern must be a string`);
      } else {
        try {
          new RegExp(raw.pattern);
        } catch {
          errors.push(`${at}.pattern is not a valid regular expression`);
        }
      }
    }
  });
}

function validateWhen(value: unknown, at: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  rejectUnknown(value, ["settings", "os"], at, errors);
  if (value.settings !== undefined && !isObject(value.settings)) {
    errors.push(`${at}.settings must be an object`);
  }
  if (
    value.os !== undefined &&
    (!Array.isArray(value.os) ||
      value.os.some((entry) => typeof entry !== "string"))
  ) {
    errors.push(`${at}.os must be an array of strings`);
  }
}

function validateAction(
  raw: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  rejectUnknown(raw, ALLOWED_ACTION, at, errors);
  requireText(raw.titleKey, `${at}.titleKey`, errors);
  optionalText(raw.descriptionKey, `${at}.descriptionKey`, errors);
  optionalText(raw.icon, `${at}.icon`, errors);
  requireEnum(raw.scope, OPERATION_SCOPES, `${at}.scope`, errors);
  requireEnum(raw.risk, OPERATION_RISKS, `${at}.risk`, errors);
  requireText(raw.permission, `${at}.permission`, errors);
  validateFields(raw.inputs, `${at}.inputs`, errors);
  validateFields(raw.outputs, `${at}.outputs`, errors);
  validateWhen(raw.when, `${at}.when`, errors);
  optionalBoolean(raw.idempotent, `${at}.idempotent`, errors);
  optionalBoolean(raw.exclusive, `${at}.exclusive`, errors);

  if (
    raw.version !== undefined &&
    (!Number.isInteger(raw.version) || (raw.version as number) < 1)
  ) {
    errors.push(`${at}.version must be a whole number from 1`);
  }
  if (raw.dryRun !== undefined) {
    requireEnum(raw.dryRun, OPERATION_DRY_RUN, `${at}.dryRun`, errors);
  }
  if (
    raw.timeoutMs !== undefined &&
    (typeof raw.timeoutMs !== "number" ||
      raw.timeoutMs <= 0 ||
      raw.timeoutMs > MAX_OPERATION_TIMEOUT_MS)
  ) {
    errors.push(`${at}.timeoutMs must be above 0 and at most 1 hour`);
  }
  if (raw.scope === "resource" && typeof raw.resource !== "string") {
    errors.push(`${at}.resource is required for scope "resource"`);
  }
  if (raw.scope !== "resource" && raw.resource !== undefined) {
    errors.push(`${at}.resource needs scope "resource"`);
  }
  if (raw.scope === "server" && raw.hostAccess !== undefined) {
    errors.push(`${at}.hostAccess does not apply to scope "server"`);
  }
  if (raw.scope === "host" || raw.scope === "resource") {
    requireEnum(
      raw.hostAccess,
      OPERATION_HOST_ACCESS,
      `${at}.hostAccess`,
      errors,
    );
    if (
      raw.risk === "destructive" &&
      (raw.hostAccess === "connect" || raw.hostAccess === "view")
    ) {
      errors.push(`${at}.hostAccess must be edit or manage when destructive`);
    }
  }
  if (raw.surfaces !== undefined) {
    if (!isObject(raw.surfaces)) {
      errors.push(`${at}.surfaces must be an object`);
    } else {
      rejectUnknown(raw.surfaces, ALLOWED_SURFACES, `${at}.surfaces`, errors);
      for (const [key, value] of Object.entries(raw.surfaces)) {
        optionalBoolean(value, `${at}.surfaces.${key}`, errors);
      }
    }
  }
}

function validateResource(
  raw: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  rejectUnknown(raw, ALLOWED_RESOURCE, at, errors);
  requireText(raw.titleKey, `${at}.titleKey`, errors);
  requireText(raw.list, `${at}.list`, errors);
  requireText(raw.key, `${at}.key`, errors);
  requireText(raw.name, `${at}.name`, errors);
  optionalText(raw.icon, `${at}.icon`, errors);
  optionalText(raw.status, `${at}.status`, errors);
  optionalText(raw.url, `${at}.url`, errors);
  optionalText(raw.tab, `${at}.tab`, errors);
  eachObject(raw.columns, `${at}.columns`, errors, (column, where) => {
    rejectUnknown(column, ["key", "titleKey", "type"], where, errors);
    requireText(column.key, `${where}.key`, errors);
    requireText(column.titleKey, `${where}.titleKey`, errors);
    if (column.type !== undefined) {
      requireEnum(column.type, RESOURCE_COLUMN_TYPES, `${where}.type`, errors);
    }
  });
  if (
    raw.filters !== undefined &&
    (!Array.isArray(raw.filters) ||
      raw.filters.some((entry) => typeof entry !== "string"))
  ) {
    errors.push(`${at}.filters must be an array of strings`);
  }
}

/** Shape checks for contributes.operations, run by validateManifest. */
export function validateOperations(
  value: unknown,
  pluginId: string | undefined,
  errors: string[],
): void {
  if (value === undefined) return;
  const root = "contributes.operations";
  if (!isObject(value)) {
    errors.push(`Field "${root}" must be an object`);
    return;
  }
  rejectUnknown(value, ALLOWED_OPERATIONS, `"${root}"`, errors);

  const ids = new Set<string>();
  eachObject(value.actions, `${root}.actions`, errors, (raw, at) => {
    requireId(raw.id, pluginId, at, ids, errors);
    validateAction(raw, at, errors);
  });

  const eventIds = new Set<string>();
  eachObject(value.events, `${root}.events`, errors, (raw, at) => {
    requireId(raw.id, pluginId, at, eventIds, errors);
    rejectUnknown(raw, ALLOWED_EVENT, at, errors);
    requireText(raw.titleKey, `${at}.titleKey`, errors);
    optionalText(raw.descriptionKey, `${at}.descriptionKey`, errors);
    requireEnum(raw.scope, ["host", "server"], `${at}.scope`, errors);
    if (raw.severity !== undefined) {
      requireEnum(raw.severity, OPERATION_SEVERITIES, `${at}.severity`, errors);
    }
    validateFields(raw.payload, `${at}.payload`, errors);
  });

  const resourceIds = new Set<string>();
  eachObject(value.resources, `${root}.resources`, errors, (raw, at) => {
    requireId(raw.id, pluginId, at, resourceIds, errors);
    validateResource(raw, at, errors);
  });

  const signalIds = new Set<string>();
  eachObject(value.signals, `${root}.signals`, errors, (raw, at) => {
    requireId(raw.id, pluginId, at, signalIds, errors);
    rejectUnknown(raw, ALLOWED_SIGNAL, at, errors);
    requireText(raw.titleKey, `${at}.titleKey`, errors);
    requireText(raw.read, `${at}.read`, errors);
    requireEnum(raw.scope, ["host", "server"], `${at}.scope`, errors);
    requireEnum(raw.kind, SIGNAL_KINDS, `${at}.kind`, errors);
    optionalText(raw.fix, `${at}.fix`, errors);
    if (
      raw.refreshSec !== undefined &&
      (typeof raw.refreshSec !== "number" || raw.refreshSec < 10)
    ) {
      errors.push(`${at}.refreshSec must be at least 10`);
    }
  });

  if (value.invokes !== undefined) {
    if (
      !Array.isArray(value.invokes) ||
      value.invokes.some(
        (entry) => typeof entry !== "string" || !INVOKE_PATTERN.test(entry),
      )
    ) {
      errors.push(
        `${root}.invokes must list action ids, "<pluginId>.*" or "*"`,
      );
    }
  }
}

/**
 * The cross-field rules: every id one declaration names must exist in this
 * plugin, or a surface would offer a button that goes nowhere.
 */
export function checkOperationReferences(
  operations: PluginOperationsContribution | undefined,
  capabilities: readonly string[],
  hasPermission: (name: string) => boolean,
  errors: string[],
): void {
  if (!operations) return;
  const root = "contributes.operations";
  const actions = new Map(
    (operations.actions ?? []).map((action) => [action.id, action]),
  );
  const resources = new Set((operations.resources ?? []).map((r) => r.id));

  const declaresAnything =
    actions.size > 0 ||
    (operations.events?.length ?? 0) > 0 ||
    resources.size > 0 ||
    (operations.signals?.length ?? 0) > 0;
  if (declaresAnything && !capabilities.includes("operations:provide")) {
    errors.push(`${root} needs the "operations:provide" capability`);
  }
  if (
    operations.invokes?.length &&
    !capabilities.includes("operations:invoke")
  ) {
    errors.push(`${root}.invokes needs the "operations:invoke" capability`);
  }

  const readAction = (id: string, where: string) => {
    const target = actions.get(id);
    if (!target) errors.push(`${where} "${id}" is not a declared action`);
    else if (target.risk !== "read") {
      errors.push(`${where} "${id}" must be a read action`);
    }
  };

  for (const action of actions.values()) {
    const at = `${root}.actions["${action.id}"]`;
    if (!hasPermission(action.permission)) {
      errors.push(
        `${at}.permission "${action.permission}" is not declared in contributes.permissions`,
      );
    }
    if (action.resource && !resources.has(action.resource)) {
      errors.push(`${at}.resource "${action.resource}" is not declared`);
    }
    if (action.check) readAction(action.check, `${at}.check`);
    if (action.undo && !actions.has(action.undo)) {
      errors.push(`${at}.undo "${action.undo}" is not a declared action`);
    }
    for (const field of action.inputs ?? []) {
      if (field.optionsFrom) {
        readAction(field.optionsFrom, `${at} input "${field.key}" optionsFrom`);
      }
      if (field.resource && !resources.has(field.resource)) {
        errors.push(`${at} input "${field.key}" names an unknown resource`);
      }
    }
  }
  for (const resource of operations.resources ?? []) {
    readAction(resource.list, `${root}.resources["${resource.id}"].list`);
  }
  for (const signal of operations.signals ?? []) {
    const at = `${root}.signals["${signal.id}"]`;
    readAction(signal.read, `${at}.read`);
    if (signal.fix && !actions.has(signal.fix)) {
      errors.push(`${at}.fix "${signal.fix}" is not a declared action`);
    }
  }
}

/** Whether a plugin's invokes list lets it run an action. */
export function invokeAllowed(
  invokes: readonly string[] | undefined,
  actionId: string,
): boolean {
  for (const entry of invokes ?? []) {
    if (entry === "*" || entry === actionId) return true;
    if (entry.endsWith(".*") && actionId.startsWith(entry.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

const RISK_RANK: Record<OperationRisk, number> = {
  read: 0,
  change: 1,
  destructive: 2,
};

export function riskRank(risk: OperationRisk): number {
  return RISK_RANK[risk];
}

/** A surface's own switch. The assistant and MCP are opt in, the rest opt out. */
export function onSurface(
  action: Pick<OperationAction, "surfaces">,
  surface: keyof OperationSurfaces,
): boolean {
  const value = action.surfaces?.[surface];
  if (surface === "assistant" || surface === "mcp") return value === true;
  return value !== false;
}

/** Whether an action applies to a host, from fields any client can read. */
export function matchesWhen(
  when: OperationWhen | undefined,
  host: { settings?: Record<string, unknown>; os?: string | null },
): boolean {
  if (!when) return true;
  for (const [key, expected] of Object.entries(when.settings ?? {})) {
    if (host.settings?.[key] !== expected) return false;
  }
  if (when.os?.length && host.os) {
    if (!when.os.includes(host.os.toLowerCase())) return false;
  }
  return true;
}

function asSettingsField(field: OperationField): PluginSettingsField {
  const type = field.type === "resource" ? "string" : field.type;
  return { ...field, type } as PluginSettingsField;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export interface OperationInputResult {
  values: Record<string, unknown>;
  errors: string[];
}

/**
 * Turns raw input into validated values. Keys no field declares are refused,
 * so nothing a handler did not ask for ever reaches it.
 */
export function parseOperationInput(
  fields: readonly OperationField[] | undefined,
  raw: unknown,
): OperationInputResult {
  const errors: string[] = [];
  const values: Record<string, unknown> = {};
  const list = fields ?? [];

  if (raw !== undefined && raw !== null && !isObject(raw)) {
    return { values, errors: ["Input must be an object"] };
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!list.some((field) => field.key === key)) {
      errors.push(`"${key}" is not an input of this action`);
    }
  }

  for (const field of list) {
    if (field.requires && input[field.requires] !== true) continue;

    let value = input[field.key];
    if (isEmpty(value)) {
      if (field.default !== undefined) {
        values[field.key] = field.default;
      } else if (field.required) {
        errors.push(`"${field.key}" is required`);
      }
      continue;
    }

    const settingsField = asSettingsField(field);
    value = coerceSettingValue(settingsField, value);

    if (field.type === "secret" && typeof value !== "string") {
      errors.push(`"${field.key}" must be a string`);
      continue;
    }
    if (field.type === "json" && typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        errors.push(`"${field.key}" must be valid JSON`);
        continue;
      }
    }

    // A list known only at run time is checked by the handler.
    const skipChoices =
      field.optionsFrom &&
      (field.type === "select" || field.type === "multiselect");
    const problem = skipChoices
      ? field.type === "select"
        ? typeof value === "string"
          ? null
          : `"${field.key}" must be a string`
        : Array.isArray(value)
          ? null
          : `"${field.key}" must be an array`
      : validateSettingValue(settingsField, value);
    if (problem) {
      errors.push(problem);
      continue;
    }

    if (
      field.pattern &&
      typeof value === "string" &&
      !new RegExp(`^(?:${field.pattern})$`).test(value)
    ) {
      errors.push(`"${field.key}" has the wrong format`);
      continue;
    }
    values[field.key] = value;
  }

  return { values, errors };
}

/** A copy safe to store or show: secret and sensitive values are replaced. */
export function redactFields(
  fields: readonly OperationField[] | undefined,
  values: unknown,
): unknown {
  if (!isObject(values)) return values;
  const copy: Record<string, unknown> = { ...values };
  for (const field of fields ?? []) {
    if (field.type !== "secret" && !field.sensitive) continue;
    if (field.key in copy) copy[field.key] = REDACTED_VALUE;
  }
  return copy;
}

/** Trims text to a byte-friendly length with a plain marker. */
export function capText(text: string, maxLength: number): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}\n[cut at ${maxLength} characters]`;
}

function fieldSchema(field: OperationField): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  if (field.default !== undefined) schema.default = field.default;
  const values = field.optionsFrom
    ? undefined
    : field.options?.map((option) => option.value);

  switch (field.type) {
    case "boolean":
      schema.type = "boolean";
      break;
    case "number":
      schema.type = "number";
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      break;
    case "select":
      schema.type = "string";
      if (values) schema.enum = values;
      break;
    case "multiselect":
      schema.type = "array";
      schema.items = values
        ? { type: "string", enum: values }
        : { type: "string" };
      break;
    case "json":
      break;
    default:
      schema.type = "string";
      if (field.pattern) schema.pattern = `^(?:${field.pattern})$`;
  }
  if (field.type === "resource" && field.resource) {
    schema["x-termix-resource"] = field.resource;
  }
  if (field.type === "secret") schema.writeOnly = true;
  return schema;
}

/** JSON Schema for a field list, for AI tools, MCP and OpenAPI. */
export function toJsonSchema(
  fields: readonly OperationField[] | undefined,
  describe?: (field: OperationField) => string | undefined,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields ?? []) {
    const schema = fieldSchema(field);
    const description = describe?.(field);
    if (description) schema.description = description;
    properties[field.key] = schema;
    if (field.required && field.default === undefined && !field.requires) {
      required.push(field.key);
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}
