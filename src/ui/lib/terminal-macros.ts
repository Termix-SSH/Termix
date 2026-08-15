export type MacroStep =
  | { id: string; type: "send"; text: string; pressEnter: boolean }
  | { id: string; type: "delay"; milliseconds: number }
  | {
      id: string;
      type: "wait";
      pattern: string;
      flags?: string;
      timeoutMs: number;
      onTimeout: "stop" | "continue";
    }
  | {
      id: string;
      type: "if";
      pattern: string;
      flags?: string;
      then: MacroStep[];
      else: MacroStep[];
    }
  | { id: string; type: "repeat"; count: number; steps: MacroStep[] };

export interface TerminalMacro {
  id: string;
  name: string;
  description?: string;
  steps: MacroStep[];
  createdAt: string;
  updatedAt: string;
}

export interface MacroTerminalAdapter {
  send(data: string): void;
  subscribe(listener: (data: string) => void): () => void;
}

export type MacroRunEvent =
  | { type: "step"; stepId: string }
  | { type: "matched"; stepId: string; match: string }
  | { type: "timeout"; stepId: string }
  | { type: "complete" };

const MAX_OUTPUT = 100_000;

function bounded(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : minimum;
}

function regex(pattern: string, flags = ""): RegExp {
  return new RegExp(pattern, flags.replace(/[gy]/g, ""));
}

function abortError(): DOMException {
  return new DOMException("Macro cancelled", "AbortError");
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export async function runTerminalMacro(
  macro: TerminalMacro,
  terminal: MacroTerminalAdapter,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: MacroRunEvent) => void;
  } = {},
): Promise<void> {
  let output = "";
  let scanFrom = 0;
  let wake: (() => void) | null = null;
  const unsubscribe = terminal.subscribe((data) => {
    const combined = output + data;
    const removed = Math.max(0, combined.length - MAX_OUTPUT);
    output = combined.slice(removed);
    scanFrom = Math.max(0, scanFrom - removed);
    wake?.();
  });

  const runSteps = async (steps: MacroStep[]): Promise<void> => {
    for (const step of steps) {
      if (options.signal?.aborted) throw abortError();
      options.onEvent?.({ type: "step", stepId: step.id });

      if (step.type === "send") {
        scanFrom = output.length;
        terminal.send(step.text + (step.pressEnter ? "\r" : ""));
        continue;
      }
      if (step.type === "delay") {
        await delay(bounded(step.milliseconds, 0, 300_000), options.signal);
        continue;
      }
      if (step.type === "if") {
        await runSteps(
          regex(step.pattern, step.flags).test(output) ? step.then : step.else,
        );
        continue;
      }
      if (step.type === "repeat") {
        const count = bounded(step.count, 1, 100);
        for (let index = 0; index < count; index += 1) {
          await runSteps(step.steps);
        }
        continue;
      }

      const matcher = regex(step.pattern, step.flags);
      const deadline = Date.now() + bounded(step.timeoutMs, 100, 300_000);
      let match = matcher.exec(output.slice(scanFrom));
      while (!match && Date.now() < deadline) {
        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          delay(Math.min(250, deadline - Date.now()), options.signal),
        ]);
        wake = null;
        match = matcher.exec(output.slice(scanFrom));
      }
      if (match) {
        scanFrom += match.index + match[0].length;
        options.onEvent?.({
          type: "matched",
          stepId: step.id,
          match: match[0],
        });
      } else {
        options.onEvent?.({ type: "timeout", stepId: step.id });
        if (step.onTimeout === "stop") {
          throw new Error(`Timed out waiting for /${step.pattern}/`);
        }
      }
    }
  };

  try {
    await runSteps(macro.steps);
    options.onEvent?.({ type: "complete" });
  } finally {
    unsubscribe();
  }
}

export function parseTerminalMacros(value?: string | null): TerminalMacro[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    let remainingSteps = 500;
    const sanitizeSteps = (input: unknown, depth: number): MacroStep[] => {
      if (!Array.isArray(input) || depth > 4 || remainingSteps <= 0) return [];
      return input.flatMap((raw): MacroStep[] => {
        if (!raw || typeof raw !== "object" || remainingSteps-- <= 0) return [];
        const step = raw as Record<string, unknown>;
        const stepId =
          typeof step.id === "string" ? step.id : `step-${remainingSteps}`;
        if (step.type === "send") {
          return [
            {
              id: stepId,
              type: "send",
              text:
                typeof step.text === "string" ? step.text.slice(0, 65_536) : "",
              pressEnter: step.pressEnter !== false,
            },
          ];
        }
        if (step.type === "delay") {
          return [
            {
              id: stepId,
              type: "delay",
              milliseconds: bounded(Number(step.milliseconds), 0, 300_000),
            },
          ];
        }
        if (step.type === "wait") {
          return [
            {
              id: stepId,
              type: "wait",
              pattern:
                typeof step.pattern === "string"
                  ? step.pattern.slice(0, 1000)
                  : "",
              flags:
                typeof step.flags === "string"
                  ? step.flags.replace(/[^imsu]/g, "")
                  : undefined,
              timeoutMs: bounded(Number(step.timeoutMs), 100, 300_000),
              onTimeout: step.onTimeout === "continue" ? "continue" : "stop",
            },
          ];
        }
        if (step.type === "if") {
          return [
            {
              id: stepId,
              type: "if",
              pattern:
                typeof step.pattern === "string"
                  ? step.pattern.slice(0, 1000)
                  : "",
              flags:
                typeof step.flags === "string"
                  ? step.flags.replace(/[^imsu]/g, "")
                  : undefined,
              then: sanitizeSteps(step.then, depth + 1),
              else: sanitizeSteps(step.else, depth + 1),
            },
          ];
        }
        if (step.type === "repeat") {
          return [
            {
              id: stepId,
              type: "repeat",
              count: bounded(Number(step.count), 1, 100),
              steps: sanitizeSteps(step.steps, depth + 1),
            },
          ];
        }
        return [];
      });
    };
    return parsed.slice(0, 100).flatMap((raw): TerminalMacro[] => {
      if (!raw || typeof raw !== "object") return [];
      const macro = raw as Record<string, unknown>;
      if (typeof macro.id !== "string" || typeof macro.name !== "string")
        return [];
      const now = new Date().toISOString();
      return [
        {
          id: macro.id,
          name: macro.name.slice(0, 200),
          description:
            typeof macro.description === "string"
              ? macro.description.slice(0, 2000)
              : undefined,
          steps: sanitizeSteps(macro.steps, 0),
          createdAt:
            typeof macro.createdAt === "string" ? macro.createdAt : now,
          updatedAt:
            typeof macro.updatedAt === "string" ? macro.updatedAt : now,
        },
      ];
    });
  } catch {
    return [];
  }
}
