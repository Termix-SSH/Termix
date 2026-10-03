export const AGENTS = ["pi", "opencode", "claude", "codex"] as const;
export type AgentKind = (typeof AGENTS)[number];
export interface AgentEvent {
  seq: number;
  kind: "text" | "tool" | "permission" | "status" | "error" | "user" | "state";
  text: string;
  requestId?: string;
  choices?: string[];
}
export interface AgentAttachment {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
}
export interface QueuedPrompt {
  id: string;
  text: string;
  attachmentIds: string[];
}
export interface AgentSession {
  title?: string;
  archived?: boolean;
  draft?: string;
  queue?: QueuedPrompt[];
  queuePaused?: boolean;
  attachments?: AgentAttachment[];

  id: string;
  userId: string;
  hostId: number;
  providerId: number;
  agent: AgentKind;
  model: string;
  cwd: string;
  executable: string;
  nativeId?: string;
  status: "starting" | "ready" | "running" | "stopped" | "error";
  events: AgentEvent[];
  updatedAt: string;
}
export function compatible(agent: AgentKind, providerType: string): boolean {
  if (agent === "claude") return providerType === "anthropic";
  if (agent === "codex")
    return ["openai", "openai_compatible"].includes(providerType);
  return ["openai", "openai_compatible", "anthropic", "ollama"].includes(
    providerType,
  );
}
/** MySQL stores plugin text as TEXT, which holds 65535 bytes. */
export const MAX_TEXT_BYTES = 65535;
export function fitsText(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES;
}
/** Cut to fit; the slack covers a split character decoding to U+FFFD. */
export function clipText(value: string): string {
  if (fitsText(value)) return value;
  return Buffer.from(value, "utf8")
    .subarray(0, MAX_TEXT_BYTES - 3)
    .toString("utf8");
}
export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function validStart(value: Record<string, unknown>): boolean {
  return (
    AGENTS.includes(value.agent as AgentKind) &&
    Number.isSafeInteger(value.hostId) &&
    Number(value.hostId) > 0 &&
    Number.isSafeInteger(value.providerId) &&
    Number(value.providerId) > 0 &&
    typeof value.model === "string" &&
    value.model.length > 0 &&
    value.model.length <= 200 &&
    typeof value.cwd === "string" &&
    value.cwd.startsWith("/") &&
    value.cwd.length <= 4096 &&
    !value.cwd.includes("\0") &&
    (value.executable === undefined ||
      (typeof value.executable === "string" &&
        /^[\w./-]{1,1024}$/.test(value.executable)))
  );
}
