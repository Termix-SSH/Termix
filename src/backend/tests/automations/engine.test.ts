import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationDefinition, Step } from "../../../types/automations.js";

/**
 * The engine reaches the database through the repository factory and the
 * outside world through the step executors, so both are mocked here. What is
 * under test is the run loop itself: ordering, branching, error policy,
 * concurrency, recursion and dry-run.
 */

interface FakeAutomation {
  id: number;
  userId: string;
  name: string;
  enabled: boolean;
  definition: string;
  concurrencyPolicy: string;
  maxRunSeconds: number;
  dryRun: boolean;
}

const automations = new Map<number, FakeAutomation>();
const runs: Array<Record<string, unknown>> = [];
const runSteps: Array<Record<string, unknown>> = [];
let nextRunId = 1;
let nextStepRowId = 1;

const repository = {
  findById: vi.fn(async (id: number) => automations.get(id) ?? null),
  createRun: vi.fn(async (input: Record<string, unknown>) => {
    const run = { id: nextRunId++, ...input };
    runs.push(run);
    return run;
  }),
  finishRun: vi.fn(async (runId: number, input: Record<string, unknown>) => {
    const run = runs.find((entry) => entry.id === runId);
    if (run) Object.assign(run, input);
  }),
  createRunStep: vi.fn(async (input: Record<string, unknown>) => {
    const id = nextStepRowId++;
    runSteps.push({ id, ...input });
    return id;
  }),
  finishRunStep: vi.fn(async (id: number, input: Record<string, unknown>) => {
    const step = runSteps.find((entry) => entry.id === id);
    if (step) Object.assign(step, input);
  }),
};

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAutomationRepository: () => repository,
}));

const executeStep = vi.fn();
vi.mock("../../automations/actions/index.js", () => ({
  executeStep: (...args: unknown[]) => executeStep(...args),
}));

const { AutomationEngine } = await import("../../automations/engine.js");

function defineAutomation(
  steps: Step[],
  overrides: Partial<FakeAutomation> = {},
): FakeAutomation {
  const definition: AutomationDefinition = {
    version: 1,
    trigger: { kind: "webhook", tokenHash: "x" },
    steps,
  };
  const automation: FakeAutomation = {
    id: overrides.id ?? 1,
    userId: "user-1",
    name: "Test",
    enabled: true,
    definition: JSON.stringify(definition),
    concurrencyPolicy: "skip",
    maxRunSeconds: 300,
    dryRun: false,
    ...overrides,
  };
  automations.set(automation.id, automation);
  return automation;
}

function step(partial: Partial<Step> & { id: string; type: string }): Step {
  return partial as Step;
}

beforeEach(() => {
  automations.clear();
  runs.length = 0;
  runSteps.length = 0;
  nextRunId = 1;
  nextStepRowId = 1;
  vi.clearAllMocks();
  executeStep.mockResolvedValue({ success: true, output: "ok" });
  // The singleton carries in-flight state between tests.
  (AutomationEngine as unknown as { instance?: unknown }).instance = undefined;
});

describe("AutomationEngine.run", () => {
  it("runs steps in order and records each one", async () => {
    defineAutomation([
      step({ id: "a", type: "run_command" }),
      step({ id: "b", type: "http" }),
    ]);

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("success");
    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(runSteps.map((s) => s.stepId)).toEqual(["a", "b"]);
    expect(runSteps.map((s) => s.stepIndex)).toEqual([0, 1]);
  });

  it("fails the run and stops when a step fails under the default policy", async () => {
    defineAutomation([
      step({ id: "a", type: "run_command" }),
      step({ id: "b", type: "http" }),
    ]);
    executeStep.mockResolvedValueOnce({ success: false, error: "boom" });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("boom");
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it("keeps going when a step is marked continue-on-error", async () => {
    defineAutomation([
      step({ id: "a", type: "run_command", onError: "continue" }),
      step({ id: "b", type: "http" }),
    ]);
    executeStep.mockResolvedValueOnce({ success: false, error: "boom" });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("success");
    expect(executeStep).toHaveBeenCalledTimes(2);
  });

  it("skips disabled steps", async () => {
    defineAutomation([
      step({ id: "a", type: "run_command", enabled: false }),
      step({ id: "b", type: "http" }),
    ]);

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(runSteps.map((s) => s.stepId)).toEqual(["b"]);
  });

  it("passes earlier step output to later steps", async () => {
    defineAutomation([
      step({ id: "first", type: "run_command" }),
      step({ id: "second", type: "http" }),
    ]);
    executeStep.mockResolvedValueOnce({ success: true, output: "hello" });

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    const secondCallContext = executeStep.mock.calls[1][1] as {
      template: { steps: Record<string, { stdout: string }> };
    };
    expect(secondCallContext.template.steps.first.stdout).toBe("hello");
  });

  it("merges variables set by a step into the template context", async () => {
    defineAutomation([
      step({ id: "setter", type: "set_var" }),
      step({ id: "next", type: "http" }),
    ]);
    executeStep.mockResolvedValueOnce({
      success: true,
      output: "x = 1",
      vars: { x: "1" },
    });

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    const context = executeStep.mock.calls[1][1] as {
      template: { vars: Record<string, string> };
    };
    expect(context.template.vars.x).toBe("1");
  });

  describe("if branching", () => {
    it("runs the then branch when the condition matches", async () => {
      defineAutomation([
        step({
          id: "cond",
          type: "if",
          condition: { left: "93", operator: ">", right: "90" },
          then: [step({ id: "yes", type: "http" })],
          else: [step({ id: "no", type: "http" })],
        }),
      ]);

      await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      expect(executeStep).toHaveBeenCalledTimes(1);
      expect(runSteps.map((s) => s.stepId)).toEqual(["cond", "yes"]);
    });

    it("runs the else branch when it does not", async () => {
      defineAutomation([
        step({
          id: "cond",
          type: "if",
          condition: { left: "10", operator: ">", right: "90" },
          then: [step({ id: "yes", type: "http" })],
          else: [step({ id: "no", type: "http" })],
        }),
      ]);

      await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      expect(runSteps.map((s) => s.stepId)).toEqual(["cond", "no"]);
    });

    it("resolves templates on both sides of the condition", async () => {
      defineAutomation([
        step({
          id: "cond",
          type: "if",
          condition: {
            left: "{{trigger.value}}",
            operator: ">=",
            right: "90",
          },
          then: [step({ id: "yes", type: "http" })],
        }),
      ]);

      await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "metric_threshold",
        triggerContext: { value: 95 },
      });

      expect(runSteps.map((s) => s.stepId)).toEqual(["cond", "yes"]);
    });

    it("treats an empty else as a no-op", async () => {
      defineAutomation([
        step({
          id: "cond",
          type: "if",
          condition: { left: "1", operator: "==", right: "2" },
          then: [step({ id: "yes", type: "http" })],
        }),
        step({ id: "after", type: "http" }),
      ]);

      await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      expect(runSteps.map((s) => s.stepId)).toEqual(["cond", "after"]);
    });
  });

  it("halts the run when a step returns a stop signal", async () => {
    defineAutomation([
      step({ id: "a", type: "run_command" }),
      step({ id: "b", type: "http" }),
    ]);
    executeStep.mockResolvedValueOnce({
      success: true,
      halt: { status: "success" },
    });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("success");
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it("marks the run failed when a stop step asks for failure", async () => {
    defineAutomation([step({ id: "a", type: "run_command" })]);
    executeStep.mockResolvedValueOnce({
      success: true,
      halt: { status: "failed" },
    });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("failed");
  });

  describe("recursion protection", () => {
    it("refuses to re-enter an automation already in the chain", async () => {
      defineAutomation([
        step({ id: "nested", type: "run_automation", automationId: 1 }),
      ]);

      const outcome = await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      // The nested call is refused, and the refusal is recorded on the step.
      const nestedStep = runSteps.find((s) => s.stepId === "nested");
      expect(nestedStep?.status).toBe("failed");
      expect(String(nestedStep?.error)).toMatch(
        /already running in this chain/,
      );
      expect(outcome.status).toBe("failed");
    });

    it("refuses a mutual cycle between two automations", async () => {
      defineAutomation(
        [step({ id: "toB", type: "run_automation", automationId: 2 })],
        { id: 1 },
      );
      defineAutomation(
        [step({ id: "toA", type: "run_automation", automationId: 1 })],
        { id: 2 },
      );

      await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      const inner = runSteps.find((s) => s.stepId === "toA");
      expect(inner?.status).toBe("failed");
      expect(String(inner?.error)).toMatch(/already running in this chain/);
    });

    it("refuses to nest deeper than the maximum depth", async () => {
      defineAutomation([step({ id: "a", type: "http" })]);

      const outcome = await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
        depth: 99,
      });

      expect(outcome.status).toBe("failed");
      expect(outcome.error).toMatch(/depth/);
      expect(runs).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("records a skipped run rather than dropping it silently", async () => {
      defineAutomation([step({ id: "slow", type: "run_command" })], {
        concurrencyPolicy: "skip",
      });

      let release: () => void = () => {};
      executeStep.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ success: true, output: "done" });
          }),
      );

      const engine = AutomationEngine.getInstance();
      const first = engine.run({ automationId: 1, triggerType: "manual" });
      // Let the first run register itself as in flight.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await engine.run({
        automationId: 1,
        triggerType: "manual",
      });
      expect(second.status).toBe("skipped");

      release();
      await first;

      const skipped = runs.find((run) => run.status === "skipped");
      expect(skipped).toBeDefined();
      expect(String(skipped?.error)).toMatch(/still in progress/);
    });
  });

  it("propagates the dry-run flag to executors", async () => {
    defineAutomation([step({ id: "a", type: "http" })], { dryRun: true });

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    const context = executeStep.mock.calls[0][1] as { dryRun: boolean };
    expect(context.dryRun).toBe(true);
  });

  it("lets a caller force a dry run on a live automation", async () => {
    defineAutomation([step({ id: "a", type: "http" })], { dryRun: false });

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
      dryRun: true,
    });

    const context = executeStep.mock.calls[0][1] as { dryRun: boolean };
    expect(context.dryRun).toBe(true);
  });

  it("fails cleanly when the automation is missing", async () => {
    const outcome = await AutomationEngine.getInstance().run({
      automationId: 404,
      triggerType: "manual",
    });
    expect(outcome).toMatchObject({ status: "failed", runId: null });
  });

  it("fails cleanly when the definition is not valid JSON", async () => {
    automations.set(1, {
      id: 1,
      userId: "user-1",
      name: "Broken",
      enabled: true,
      definition: "not json",
      concurrencyPolicy: "skip",
      maxRunSeconds: 300,
      dryRun: false,
    });

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/not valid JSON/);
  });

  it("turns a thrown executor error into a failed step", async () => {
    defineAutomation([step({ id: "a", type: "run_command" })]);
    executeStep.mockRejectedValueOnce(new Error("connection reset"));

    const outcome = await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(outcome.status).toBe("failed");
    expect(runSteps[0].status).toBe("failed");
    expect(String(runSteps[0].error)).toMatch(/connection reset/);
  });

  it("truncates very large step output", async () => {
    defineAutomation([step({ id: "a", type: "run_command" })]);
    executeStep.mockResolvedValueOnce({
      success: true,
      output: "x".repeat(40_000),
    });

    await AutomationEngine.getInstance().run({
      automationId: 1,
      triggerType: "manual",
    });

    expect(runSteps[0].truncated).toBe(true);
    expect(String(runSteps[0].output)).toMatch(/truncated/);
  });

  it("stops once the run deadline has passed", async () => {
    defineAutomation(
      [step({ id: "a", type: "run_command" }), step({ id: "b", type: "http" })],
      { maxRunSeconds: 1 },
    );

    // The first step consumes the whole budget, so the second must not start.
    executeStep.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 5_000);
      return { success: true, output: "slow" };
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const outcome = await AutomationEngine.getInstance().run({
        automationId: 1,
        triggerType: "manual",
      });

      expect(outcome.status).toBe("timeout");
      expect(executeStep).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
