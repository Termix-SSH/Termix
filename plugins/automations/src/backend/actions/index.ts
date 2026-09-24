import type { Client } from "ssh2";
import { DEFAULT_STEP_TIMEOUT_MS, type Step } from "../../types.js";
import { execCommand, execElevated } from "@termix/plugin-sdk/host-commands";
import { renderRecord, renderTemplate } from "../template.js";
import { resolveTargets, type ResolvedTarget } from "./host-targets.js";
import {
  fail,
  ok,
  stepTimeout,
  type StepExecutionContext,
  type StepResult,
  type StepRuntime,
} from "./types.js";

/** The admin allowlist of private hosts an HTTP step may reach. */
const PRIVATE_ALLOWLIST_KEY = "notification_private_endpoint_allowlist";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * One executor per step type.
 *
 * Anything that leaves Termix checks context.dryRun first and reports what it
 * would have done instead of doing it, so an automation can be exercised
 * safely while it is being built.
 */
export async function executeStep(
  step: Step,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  switch (step.type) {
    case "notify":
      return runNotify(step, context, runtime);
    case "http":
      return runHttp(step, context, runtime);
    case "run_command":
      return runCommand(step, context, runtime);
    case "run_snippet":
      return runSnippet(step, context, runtime);
    case "docker":
      return runDocker(step, context, runtime);
    case "tunnel":
      return runTunnel(step, context, runtime);
    case "wol":
      return runWol(step, context, runtime);
    case "wait":
      return runWait(step, context);
    case "set_var":
      return runSetVar(step, context);
    case "stop":
      return {
        success: true,
        halt: { status: step.status ?? "success" },
        output: `Stopped with status ${step.status ?? "success"}`,
      };
    default:
      return fail(`Unsupported step type: ${(step as Step).type}`);
  }
}

async function runNotify(
  step: Extract<Step, { type: "notify" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const title = renderTemplate(step.title ?? "", context.template);
  const body = renderTemplate(step.body ?? "", context.template);

  if (step.channelIds.length === 0) {
    return fail("No notification channels selected");
  }
  if (context.dryRun) {
    return ok(
      `Would notify ${step.channelIds.length} channel(s): ${title || body}`,
    );
  }

  const trigger = context.template.trigger ?? {};
  let result;
  try {
    result = await runtime.ctx.notify.send(step.channelIds, {
      title: title || "Termix automation",
      body,
      severity: step.severity ?? "warning",
      context: {
        hostId:
          context.template.host?.id ??
          (typeof trigger.hostId === "number" ? trigger.hostId : undefined),
        hostName:
          context.template.host?.name ??
          (typeof trigger.hostName === "string" ? trigger.hostName : undefined),
        sourceId: context.automationId,
        sourceName: title || undefined,
        triggerType:
          typeof trigger.type === "string" ? trigger.type : undefined,
        value: trigger.value,
        threshold: trigger.threshold,
      },
    });
  } catch (error) {
    return fail(errorText(error));
  }

  const errors = result.failures.map((f) => `${f.name}: ${f.error}`);
  if (result.delivered === 0) {
    return fail(errors.join("; ") || "No enabled channels to notify");
  }
  return ok(
    `Notified ${result.delivered} channel(s)${errors.length ? `; ${errors.join("; ")}` : ""}`,
  );
}

async function runHttp(
  step: Extract<Step, { type: "http" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const url = renderTemplate(step.url, context.template);
  const headers = renderRecord(step.headers, context.template);
  const body = step.body
    ? renderTemplate(step.body, context.template)
    : undefined;

  if (context.dryRun) {
    return ok(`Would ${step.method} ${url}`);
  }

  try {
    // Private delivery needs both the step's opt-in and an exact host in
    // the admin allowlist.
    const allowPrivateHosts = step.allowPrivateNetwork
      ? parseAllowlist(
          await runtime.ctx.settings.readCore(PRIVATE_ALLOWLIST_KEY),
        )
      : [];
    const response = await runtime.ctx.fetch(url, {
      method: step.method,
      headers: body
        ? { "Content-Type": "application/json", ...(headers ?? {}) }
        : headers,
      body,
      allowPrivateHosts,
      timeoutMs: stepTimeout(context, step.timeoutMs, DEFAULT_STEP_TIMEOUT_MS),
    });

    const text = await response.text();
    const summary = `HTTP ${response.status} ${response.statusText}\n${text}`;
    return response.ok ? ok(summary) : fail(`HTTP ${response.status}`, summary);
  } catch (error) {
    return fail(errorText(error));
  }
}

function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function runCommand(
  step: Extract<Step, { type: "run_command" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const command = renderTemplate(step.command, context.template);
  return runOnTargets(step.hostSelector, context, runtime, async (target) => {
    if (context.dryRun) {
      return { output: `Would run on ${target.name}: ${command}` };
    }
    return execOnHost(
      target.host,
      command,
      step.elevated,
      context,
      runtime,
      step.timeoutMs,
    );
  });
}

async function runSnippet(
  step: Extract<Step, { type: "run_snippet" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const snippets = runtime.deps.snippets();
  const getSnippet = snippets.get;
  const resolveCommand = snippets.resolveCommand;
  if (
    typeof getSnippet !== "function" ||
    typeof resolveCommand !== "function"
  ) {
    return fail("The snippets plugin is not available");
  }
  const snippet = await getSnippet(step.snippetId).catch(() => null);

  if (!snippet) return fail("Snippet not found");
  if (snippet.isNote) return fail("Notes cannot be executed on a host");

  // Template values only ever reach the snippet through inputValues, never by
  // rewriting the snippet body, so automation variables cannot inject snippet
  // syntax of their own.
  const inputValues = renderRecord(step.inputValues, context.template) ?? {};

  return runOnTargets(step.hostSelector, context, runtime, async (target) => {
    const command = await resolveCommand(
      step.snippetId,
      {
        ip: target.host.ip,
        username: target.host.username,
        port: target.host.port,
        name: target.name,
      },
      inputValues,
    ).catch(() => null);
    if (!command) {
      return { output: "", error: "Snippet could not be resolved" };
    }

    if (context.dryRun) {
      return { output: `Would run snippet on ${target.name}: ${command}` };
    }
    return execOnHost(
      target.host,
      command,
      step.elevated,
      context,
      runtime,
      step.timeoutMs,
    );
  });
}

async function runDocker(
  step: Extract<Step, { type: "docker" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const container = renderTemplate(step.container, context.template);
  if (!container) return fail("Container name is required");
  const action = runtime.deps.docker().action;
  if (typeof action !== "function") {
    return fail("The docker plugin is not available");
  }

  return runOnTargets(step.hostSelector, context, runtime, async (target) => {
    if (context.dryRun) {
      return {
        output: `Would ${step.action} container ${container} on ${target.name}`,
      };
    }

    try {
      await action(target.id, container, step.action);
      return { output: `Container ${container}: ${step.action} done` };
    } catch (error) {
      return { output: "", error: errorText(error) };
    }
  });
}

async function runTunnel(
  step: Extract<Step, { type: "tunnel" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const name = renderTemplate(step.tunnelName, context.template);
  if (context.dryRun) return ok(`Would ${step.action} tunnel ${name}`);

  const tunnels = runtime.deps.tunnels();
  const act = step.action === "connect" ? tunnels.start : tunnels.stop;
  if (typeof act !== "function") {
    return fail("The tunnels plugin is not available");
  }
  // A disconnect goes through the tunnels plugin's manual stop, which also
  // holds off its retries, so the tunnel stays down.
  try {
    await act(name);
  } catch (error) {
    return fail(errorText(error));
  }
  return ok(
    step.action === "connect"
      ? `Tunnel ${name} connected`
      : `Tunnel ${name} disconnected`,
  );
}

async function runWol(
  step: Extract<Step, { type: "wol" }>,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<StepResult> {
  const host = await runtime.ctx.hosts.get(step.hostId).catch(() => null);
  if (!host) return fail("Host not found or not accessible");
  const name = host.name || host.ip;

  const wake = runtime.deps.wakeOnLan().wake;
  if (typeof wake !== "function") {
    return fail("The wake-on-lan plugin is not available");
  }
  if (context.dryRun) return ok(`Would wake ${name}`);

  try {
    await wake(step.hostId);
    return ok(`Sent magic packet to ${name}`);
  } catch (error) {
    return fail(errorText(error));
  }
}

async function runWait(
  step: Extract<Step, { type: "wait" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const requested = Math.max(step.seconds, 0) * 1000;
  const waitMs = Math.min(
    requested,
    stepTimeout(context, undefined, requested),
  );
  if (context.dryRun) return ok(`Would wait ${step.seconds}s`);

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return ok(`Waited ${Math.round(waitMs / 1000)}s`);
}

async function runSetVar(
  step: Extract<Step, { type: "set_var" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const value = renderTemplate(step.value, context.template);
  return ok(`${step.name} = ${value}`, { [step.name]: value });
}

/**
 * Runs a per-host action across a selector's targets. One host failing does
 * not stop the others, matching how fleet execution behaves.
 */
async function runOnTargets(
  selector: Extract<Step, { type: "run_command" }>["hostSelector"],
  context: StepExecutionContext,
  runtime: StepRuntime,
  run: (target: ResolvedTarget) => Promise<{ output?: string; error?: string }>,
): Promise<StepResult> {
  const { targets, skipped } = await resolveTargets(selector, context, runtime);

  if (targets.length === 0) {
    return fail(
      skipped.length > 0
        ? `No accessible hosts (${skipped.length} skipped)`
        : "No hosts matched the selector",
    );
  }

  const results = await Promise.allSettled(
    targets.map(async (target) => ({
      target,
      result: await run(target),
    })),
  );

  const lines: string[] = [];
  let failures = 0;

  for (const [index, settled] of results.entries()) {
    const name = targets[index].name;
    if (settled.status === "rejected") {
      failures++;
      lines.push(`${name}: ${String(settled.reason)}`);
      continue;
    }
    const { result } = settled.value;
    if (result.error) {
      failures++;
      lines.push(`${name}: ${result.error}`);
    } else {
      lines.push(`${name}: ${result.output ?? "ok"}`);
    }
  }

  if (skipped.length > 0) {
    lines.push(`${skipped.length} host(s) skipped: no access`);
  }

  const output = lines.join("\n");
  return failures > 0 && failures === targets.length
    ? fail(`All ${failures} host(s) failed`, output)
    : ok(output);
}

async function execOnHost(
  host: ResolvedTarget["host"],
  command: string,
  elevated: boolean | undefined,
  context: StepExecutionContext,
  runtime: StepRuntime,
  timeoutMs: number | undefined,
): Promise<{ output?: string; error?: string }> {
  const timeout = stepTimeout(context, timeoutMs, DEFAULT_STEP_TIMEOUT_MS);
  if (timeout <= 0) return { error: "Run deadline exceeded" };

  try {
    const result = await runtime.ctx.ssh.withConnection<
      { stdout: string; stderr: string; code: number | null },
      Client
    >(host, { pool: "automations", purpose: "fleet" }, async (client) => {
      if (elevated) {
        return execElevated(
          client,
          command,
          host.sudoPassword as string | undefined,
          { timeoutMs: timeout },
        );
      }
      return execCommand(client, command, timeout);
    });

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (result.code === 0 || result.code === null) {
      return { output: output || "(no output)" };
    }
    return { error: `Exited with code ${result.code}`, output };
  } catch (error) {
    return { error: errorText(error) };
  }
}
