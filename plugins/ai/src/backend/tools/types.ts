import type { PluginContext } from "@termix/plugin-sdk/backend";

export type ToolCategory = "read" | "propose";

/** What tools and the proposal executor reach core and other plugins through. */
export type ToolDeps = Pick<
  PluginContext,
  "hosts" | "services" | "notify" | "rbac" | "ssh" | "audit"
>;

export interface ToolContext {
  /** Always the request's authenticated user, never from model input. */
  userId: string;
  conversationId: number;
  /** Per-user opt-in for running allowlisted read-only commands. */
  allowReadOnlyCommands: boolean;
  deps: ToolDeps;
}

export interface AiTool {
  name: string;
  description: string;
  category: ToolCategory;
  /**
   * The service this tool needs. While no plugin provides it, the tool is
   * not offered to the model at all.
   */
  service?: string;
  /** Offered only to a user who turned on read-only commands. */
  requiresReadOnlyCommands?: boolean;
  /** JSON Schema for the arguments, sent to the provider verbatim. */
  parameters: Record<string, unknown>;
  /**
   * Read tools return data to feed back to the model. Propose tools return a
   * ProposalDraft and must not mutate anything.
   */
  handler: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<unknown>;
}

/** What a provider adapter needs to describe a tool to its model. */
export interface ToolDefinitionShape {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProposalDraft {
  __proposal: true;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
}

export function isProposalDraft(value: unknown): value is ProposalDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ProposalDraft).__proposal === true
  );
}

export function proposal(
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
): ProposalDraft {
  return { __proposal: true, kind, summary, payload };
}

/** Small helper so tool schemas stay readable. */
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export const str = (description: string) => ({ type: "string", description });
export const num = (description: string) => ({ type: "number", description });
export const bool = (description: string) => ({ type: "boolean", description });
