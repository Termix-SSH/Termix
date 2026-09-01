import {
  DEFAULT_STEP_TIMEOUT_MS,
  type Step,
} from "../../../types/automations.js";
import { execCommand } from "../../hosts/metrics/widgets/common-utils.js";
import {
  execElevated,
  shellSingleQuote,
} from "../../hosts/metrics/managers/exec-elevated.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../../hosts/ssh-client-factory.js";
import { withConnection } from "../../hosts/ssh-connection-pool.js";
import { resolveSnippetCommand } from "../../database/routes/snippets-execution.js";
import {
  createCurrentAlertRepository,
  createCurrentSnippetRepository,
} from "../../database/repositories/factory.js";
import { sendAutomationNotification } from "../notify.js";
import { automationFetch } from "../http.js";
import { renderRecord, renderTemplate } from "../template.js";
import { resolveTargets, type ResolvedTarget } from "./host-targets.js";
import {
  fail,
  ok,
  stepTimeout,
  type StepExecutionContext,
  type StepResult,
} from "./types.js";

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
): Promise<StepResult> {
  switch (step.type) {
    case "notify":
      return runNotify(step, context);
    case "http":
      return runHttp(step, context);
    case "run_command":
      return runCommand(step, context);
    case "run_snippet":
      return runSnippet(step, context);
    case "docker":
      return runDocker(step, context);
    case "tunnel":
      return runTunnel(step, context);
    case "wol":
      return runWol(step, context);
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

  const repository = createCurrentAlertRepository();
  const channels = await repository.listNotificationChannels(context.userId);
  const selected = channels.filter((channel) =>
    step.channelIds.includes(channel.id),
  );

  if (selected.length === 0) {
    return fail("Selected notification channels no longer exist");
  }

  let delivered = 0;
  const errors: string[] = [];
  for (const channel of selected) {
    if (!channel.enabled) continue;
    try {
      await sendAutomationNotification(
        { id: channel.id, type: channel.type, config: channel.config },
        {
          title,
          body,
          severity: step.severity ?? "warning",
          context: context.template,
        },
      );
      delivered++;
    } catch (error) {
      errors.push(
        `${channel.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (delivered === 0) {
    return fail(errors.join("; ") || "No enabled channels to notify");
  }
  return ok(
    `Notified ${delivered} channel(s)${errors.length ? `; ${errors.join("; ")}` : ""}`,
  );
}

async function runHttp(
  step: Extract<Step, { type: "http" }>,
  context: StepExecutionContext,
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
    const response = await automationFetch(url, {
      method: step.method,
      headers,
      body,
      allowPrivateNetwork: step.allowPrivateNetwork,
      timeoutMs: stepTimeout(context, step.timeoutMs, DEFAULT_STEP_TIMEOUT_MS),
    });

    const text = await response.text();
    const summary = `HTTP ${response.status} ${response.statusText}\n${text}`;
    return response.ok ? ok(summary) : fail(`HTTP ${response.status}`, summary);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function runCommand(
  step: Extract<Step, { type: "run_command" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const command = renderTemplate(step.command, context.template);
  return runOnTargets(step.hostSelector, context, async (target) => {
    if (context.dryRun) {
      return { output: `Would run on ${target.name}: ${command}` };
    }
    return execOnHost(
      target.host,
      command,
      step.elevated,
      context,
      step.timeoutMs,
    );
  });
}

async function runSnippet(
  step: Extract<Step, { type: "run_snippet" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const snippet = await createCurrentSnippetRepository()
    .findOwnedById(context.userId, step.snippetId)
    .catch(() => null);

  if (!snippet) return fail("Snippet not found");
  if (snippet.isNote) return fail("Notes cannot be executed on a host");

  // Template values only ever reach the snippet through inputValues, never by
  // rewriting the snippet body, so automation variables cannot inject snippet
  // syntax of their own.
  const inputValues = renderRecord(step.inputValues, context.template) ?? {};

  return runOnTargets(step.hostSelector, context, async (target) => {
    const command = resolveSnippetCommand(
      snippet.content,
      {
        ip: target.host.ip,
        username: target.host.username,
        port: target.host.port,
        name: target.host.name,
      },
      inputValues,
    );

    if (context.dryRun) {
      return { output: `Would run snippet on ${target.name}: ${command}` };
    }
    return execOnHost(
      target.host,
      command,
      step.elevated,
      context,
      step.timeoutMs,
    );
  });
}

async function runDocker(
  step: Extract<Step, { type: "docker" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const container = renderTemplate(step.container, context.template);
  if (!container) return fail("Container name is required");

  return runOnTargets(step.hostSelector, context, async (target) => {
    if (context.dryRun) {
      return {
        output: `Would ${step.action} container ${container} on ${target.name}`,
      };
    }

    // The Docker HTTP routes are tied to an interactive session, so run the
    // equivalent command over the same pooled SSH connection everything else
    // uses. The container name is quoted because it comes from a template.
    const command = `docker ${step.action} ${shellSingleQuote(container)}`;
    return execOnHost(target.host, command, false, context, step.timeoutMs);
  });
}

async function runTunnel(
  step: Extract<Step, { type: "tunnel" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const name = renderTemplate(step.tunnelName, context.template);
  if (context.dryRun) return ok(`Would ${step.action} tunnel ${name}`);

  try {
    const manager = await import("../../hosts/tunnel/manager.js");
    const config = manager.tunnelConfigs?.get(name);
    if (!config) return fail(`Tunnel "${name}" is not configured`);

    if (step.action === "connect") {
      await manager.connectSSHTunnel(config);
      return ok(`Tunnel ${name} connected`);
    }

    // shouldRetry false, otherwise the manager immediately reconnects the
    // tunnel the automation just asked it to drop.
    manager.manualDisconnects.add(name);
    await manager.handleDisconnect(name, config, false);
    return ok(`Tunnel ${name} disconnected`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function runWol(
  step: Extract<Step, { type: "wol" }>,
  context: StepExecutionContext,
): Promise<StepResult> {
  const host = await resolveTargets(
    { kind: "host", hostId: step.hostId },
    context,
  );
  const target = host.targets[0];
  if (!target?.host) return fail("Host not found or not accessible");

  const mac = (target.host as { macAddress?: string }).macAddress;
  if (!mac) return fail("Host has no MAC address configured");
  if (context.dryRun) return ok(`Would wake ${target.name} (${mac})`);

  try {
    const { sendWakeOnLan, isValidMac } =
      await import("../../utils/wake-on-lan.js");
    if (!isValidMac(mac)) return fail(`Invalid MAC address: ${mac}`);
    await sendWakeOnLan(mac);
    return ok(`Sent magic packet to ${target.name}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
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
  run: (target: ResolvedTarget) => Promise<{ output?: string; error?: string }>,
): Promise<StepResult> {
  const { targets, skipped } = await resolveTargets(selector, context);

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
  timeoutMs: number | undefined,
): Promise<{ output?: string; error?: string }> {
  const sshHost = host as ResolvedTarget["host"] & { sudoPassword?: string };
  const timeout = stepTimeout(context, timeoutMs, DEFAULT_STEP_TIMEOUT_MS);
  if (timeout <= 0) return { error: "Run deadline exceeded" };

  try {
    const result = await withConnection(
      getFleetPoolKey(sshHost),
      createFleetSshFactory(sshHost),
      async (client) => {
        if (elevated) {
          return execElevated(client, command, sshHost.sudoPassword, {
            timeoutMs: timeout,
          });
        }
        return execCommand(client, command, timeout);
      },
    );

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (result.code === 0 || result.code === null) {
      return { output: output || "(no output)" };
    }
    return { error: `Exited with code ${result.code}`, output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
