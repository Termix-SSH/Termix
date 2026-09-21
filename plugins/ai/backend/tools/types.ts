export type ToolCategory = "read" | "propose";

export interface ToolContext {
  /** Always taken from the verified JWT, never from model input. */
  userId: string;
  conversationId: number;
  /** Per-user opt-in for running allowlisted read-only commands. */
  allowReadOnlyCommands: boolean;
}

export interface AiTool {
  name: string;
  description: string;
  category: ToolCategory;
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
