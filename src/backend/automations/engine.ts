import type {
  AutomationDefinition,
  RunStatus,
  Step,
} from "../../types/automations.js";
import {
  DEFAULT_MAX_RUN_SECONDS,
  MAX_AUTOMATION_DEPTH,
  MAX_STEP_OUTPUT_BYTES,
} from "../../types/automations.js";
import { createCurrentAutomationRepository } from "../database/repositories/factory.js";
import { statsLogger } from "../utils/logger.js";
import { executeStep } from "./actions/index.js";
import type { StepExecutionContext, StepResult } from "./actions/types.js";
import { compare } from "./conditions.js";
import { renderTemplate, type TemplateContext } from "./template.js";

export interface RunRequest {
  automationId: number;
  triggerType: string;
  triggerContext?: Record<string, unknown>;
  triggerHostId?: number;
  /** Overrides the automation's own dry-run flag, for "test run". */
  dryRun?: boolean;
  parentRunId?: number;
  ancestry?: number[];
  depth?: number;
}

export interface RunOutcome {
  runId: number | null;
  status: RunStatus;
  error?: string;
}

/**
 * Executes automations.
 *
 * Both HTTP handlers and the metrics hooks live in this same process, so this
 * is a plain singleton rather than anything cross-process. State that has to
 * survive a restart (cooldowns, dwell windows) lives in the database; the only
 * thing held in memory is the set of runs currently in flight, which is
 * meaningless after a restart anyway.
 */
export class AutomationEngine {
  private static instance: AutomationEngine;

  private readonly running = new Set<number>();
  private readonly queued = new Map<number, number>();

  static getInstance(): AutomationEngine {
    if (!AutomationEngine.instance) {
      AutomationEngine.instance = new AutomationEngine();
    }
    return AutomationEngine.instance;
  }

  isRunning(automationId: number): boolean {
    return this.running.has(automationId);
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const repository = createCurrentAutomationRepository();
    const automation = await repository.findById(request.automationId);

    if (!automation) {
      return { runId: null, status: "failed", error: "Automation not found" };
    }

    const depth = request.depth ?? 0;
    const ancestry = request.ancestry ?? [];

    // Refuse recursion before anything is recorded, so a cycle cannot spin.
    if (depth > MAX_AUTOMATION_DEPTH) {
      return {
        runId: null,
        status: "failed",
        error: `Maximum automation depth of ${MAX_AUTOMATION_DEPTH} exceeded`,
      };
    }
    if (ancestry.includes(automation.id)) {
      return {
        runId: null,
        status: "failed",
        error: `Automation ${automation.id} is already running in this chain`,
      };
    }

    let definition: AutomationDefinition;
    try {
      definition = JSON.parse(automation.definition) as AutomationDefinition;
    } catch {
      return {
        runId: null,
        status: "failed",
        error: "Automation definition is not valid JSON",
      };
    }

    // A second trigger while a run is in flight is recorded as skipped rather
    // than dropped silently, so the history explains what happened.
    if (this.running.has(automation.id)) {
      const policy = automation.concurrencyPolicy;
      if (policy === "skip") {
        const run = await repository.createRun({
          automationId: automation.id,
          userId: automation.userId,
          triggerType: request.triggerType,
          triggerContext: JSON.stringify(request.triggerContext ?? {}),
          status: "skipped",
        });
        await repository.finishRun(run.id, {
          status: "skipped",
          error: "A previous run was still in progress",
          durationMs: 0,
        });
        return { runId: run.id, status: "skipped" };
      }
      if (policy === "queue") {
        const depthNow = this.queued.get(automation.id) ?? 0;
        if (depthNow >= 5) {
          return { runId: null, status: "skipped", error: "Queue is full" };
        }
        this.queued.set(automation.id, depthNow + 1);
        await this.waitUntilFree(automation.id);
        this.queued.set(
          automation.id,
          (this.queued.get(automation.id) ?? 1) - 1,
        );
      }
    }

    const dryRun = request.dryRun ?? automation.dryRun;
    const maxRunSeconds = automation.maxRunSeconds || DEFAULT_MAX_RUN_SECONDS;
    const startedAt = Date.now();

    const run = await repository.createRun({
      automationId: automation.id,
      userId: automation.userId,
      triggerType: request.triggerType,
      triggerContext: JSON.stringify(request.triggerContext ?? {}),
      status: "running",
      dryRun,
      parentRunId: request.parentRunId ?? null,
    });

    this.running.add(automation.id);

    const template: TemplateContext = {
      trigger: request.triggerContext ?? {},
      steps: {},
      vars: {},
      run: {
        id: run.id,
        automationId: automation.id,
        startedAt: new Date(startedAt).toISOString(),
      },
    };

    const context: StepExecutionContext = {
      userId: automation.userId,
      automationId: automation.id,
      runId: run.id,
      dryRun,
      template,
      triggerHostId: request.triggerHostId,
      ancestry: [...ancestry, automation.id],
      depth,
      deadlineAt: startedAt + maxRunSeconds * 1000,
    };

    let status: RunStatus = "success";
    let error: string | undefined;

    try {
      const result = await this.runSteps(definition.steps ?? [], context, {
        index: 0,
      });
      if (result.halted?.status === "failed") {
        status = "failed";
        error = "Stopped by a stop step";
      } else if (result.failed) {
        status = "failed";
        error = result.error;
      }
      if (Date.now() >= context.deadlineAt) {
        status = "timeout";
        error = `Run exceeded ${maxRunSeconds}s`;
      }
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    } finally {
      this.running.delete(automation.id);
    }

    await repository.finishRun(run.id, {
      status,
      error: error ?? null,
      durationMs: Date.now() - startedAt,
    });

    if (status === "failed") {
      statsLogger.warn(`Automation "${automation.name}" failed`, {
        operation: "automation_run_failed",
        automationId: automation.id,
        runId: run.id,
        error,
      });
    }

    return { runId: run.id, status, error };
  }

  /**
   * Runs a list of steps in order, descending into if/else. Returns as soon as
   * a stop step halts the run or a failing step's policy says to stop.
   */
  private async runSteps(
    steps: Step[],
    context: StepExecutionContext,
    cursor: { index: number },
  ): Promise<{
    failed: boolean;
    error?: string;
    halted?: { status: "success" | "failed" };
  }> {
    const repository = createCurrentAutomationRepository();

    for (const step of steps) {
      if (step.enabled === false) continue;

      if (Date.now() >= context.deadlineAt) {
        return { failed: true, error: "Run deadline exceeded" };
      }

      const stepIndex = cursor.index++;

      if (step.type === "if") {
        const left = renderTemplate(step.condition.left, context.template);
        const right = renderTemplate(
          step.condition.right ?? "",
          context.template,
        );
        const matched = compare(left, step.condition.operator, right);

        const rowId = await repository.createRunStep({
          runId: context.runId,
          stepIndex,
          stepId: step.id,
          stepType: "if",
          status: "running",
        });
        await repository.finishRunStep(rowId, {
          status: "success",
          output: `Condition ${matched ? "matched" : "did not match"}: ${left} ${step.condition.operator} ${right}`,
        });

        const branch = matched ? step.then : (step.else ?? []);
        const result = await this.runSteps(branch, context, cursor);
        if (result.halted) return result;
        if (result.failed) return result;
        continue;
      }

      if (step.type === "run_automation") {
        const rowId = await repository.createRunStep({
          runId: context.runId,
          stepIndex,
          stepId: step.id,
          stepType: step.type,
          status: "running",
        });

        const nested = await this.run({
          automationId: step.automationId,
          triggerType: "run_automation",
          triggerContext: { parentAutomationId: context.automationId },
          triggerHostId: context.triggerHostId,
          dryRun: context.dryRun,
          parentRunId: context.runId,
          ancestry: context.ancestry,
          depth: context.depth + 1,
        });

        const nestedOk = nested.status === "success";
        await repository.finishRunStep(rowId, {
          status: nestedOk ? "success" : "failed",
          output: `Nested run ${nested.runId ?? "not started"}: ${nested.status}`,
          error: nested.error ?? null,
        });

        if (!nestedOk && (step.onError ?? "stop") === "stop") {
          return { failed: true, error: nested.error ?? "Nested run failed" };
        }
        continue;
      }

      const rowId = await repository.createRunStep({
        runId: context.runId,
        stepIndex,
        stepId: step.id,
        stepType: step.type,
        status: "running",
      });

      let result: StepResult;
      try {
        result = await executeStep(step, context);
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const { text, truncated } = truncate(result.output);
      await repository.finishRunStep(rowId, {
        status: result.success ? "success" : "failed",
        output: text,
        error: result.error ?? null,
        truncated,
      });

      // Later steps read earlier output through {{steps.<id>.stdout}}.
      context.template.steps = {
        ...context.template.steps,
        [step.id]: {
          stdout: result.output ?? "",
          code: result.success ? 0 : 1,
        },
      };
      if (result.vars) {
        context.template.vars = { ...context.template.vars, ...result.vars };
      }

      if (result.halt) return { failed: false, halted: result.halt };

      if (!result.success) {
        const policy = step.onError ?? "stop";
        if (policy === "stop") {
          return { failed: true, error: result.error };
        }
      }
    }

    return { failed: false };
  }

  private async waitUntilFree(automationId: number): Promise<void> {
    const started = Date.now();
    while (this.running.has(automationId)) {
      if (Date.now() - started > 60_000) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Keeps a single step's output from bloating the database. */
function truncate(output: string | undefined): {
  text: string | null;
  truncated: boolean;
} {
  if (!output) return { text: null, truncated: false };
  if (Buffer.byteLength(output, "utf8") <= MAX_STEP_OUTPUT_BYTES) {
    return { text: output, truncated: false };
  }
  return {
    text: output.slice(0, MAX_STEP_OUTPUT_BYTES) + "\n... (truncated)",
    truncated: true,
  };
}
