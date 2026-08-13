import type { Step } from "../../../types/automations.js";
import type { TemplateContext } from "../template.js";

/** What every executor returns. `output` is what later steps can read. */
export interface StepResult {
  success: boolean;
  output?: string;
  error?: string;
  /** Merged into the run's variables, for set_var and friends. */
  vars?: Record<string, string>;
  /** Set by the stop step to end the run early. */
  halt?: { status: "success" | "failed" };
}

export interface StepExecutionContext {
  userId: string;
  automationId: number;
  runId: number;
  /** Nothing that leaves Termix may actually happen when this is set. */
  dryRun: boolean;
  template: TemplateContext;
  /** Host the trigger fired for, when there was one. */
  triggerHostId?: number;
  /** Automations already on the stack, to refuse recursion. */
  ancestry: number[];
  depth: number;
  /** Wall-clock deadline for the whole run. */
  deadlineAt: number;
  signal?: AbortSignal;
}

export type StepExecutor<T extends Step = Step> = (
  step: T,
  context: StepExecutionContext,
) => Promise<StepResult>;

export function ok(output?: string, vars?: Record<string, string>): StepResult {
  return { success: true, output, vars };
}

export function fail(error: string, output?: string): StepResult {
  return { success: false, error, output };
}

/** Milliseconds left before the run's overall deadline. */
export function remainingMs(context: StepExecutionContext): number {
  return Math.max(context.deadlineAt - Date.now(), 0);
}

/** A step's timeout, clamped so it can never outlive the run. */
export function stepTimeout(
  context: StepExecutionContext,
  requested: number | undefined,
  fallback: number,
): number {
  const wanted = requested && requested > 0 ? requested : fallback;
  return Math.max(Math.min(wanted, remainingMs(context)), 0);
}
