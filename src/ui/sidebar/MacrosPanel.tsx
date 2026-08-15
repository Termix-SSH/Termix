import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Plus, Save, Square, Trash2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";
import {
  parseTerminalMacros,
  runTerminalMacro,
  type MacroStep,
  type TerminalMacro,
} from "@/lib/terminal-macros";
import type { Tab } from "@/types/ui-types";

const fieldClass =
  "h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";

function id(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createStep(type: MacroStep["type"]): MacroStep {
  const stepId = id();
  switch (type) {
    case "send":
      return { id: stepId, type, text: "", pressEnter: true };
    case "delay":
      return { id: stepId, type, milliseconds: 500 };
    case "wait":
      return {
        id: stepId,
        type,
        pattern: "",
        timeoutMs: 10_000,
        onTimeout: "stop",
      };
    case "if":
      return { id: stepId, type, pattern: "", then: [], else: [] };
    case "repeat":
      return { id: stepId, type, count: 2, steps: [] };
  }
}

function StepList({
  steps,
  onChange,
  depth = 0,
}: {
  steps: MacroStep[];
  onChange: (steps: MacroStep[]) => void;
  depth?: number;
}) {
  const update = (index: number, step: MacroStep) => {
    const next = [...steps];
    next[index] = step;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className="rounded border border-border bg-muted/20 p-2"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {index + 1}. {step.type}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-6"
              onClick={() => onChange(steps.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>

          {step.type === "send" && (
            <div className="space-y-2">
              <textarea
                className={`${fieldClass} min-h-16 py-2 font-mono`}
                placeholder="Command or text"
                value={step.text}
                onChange={(event) =>
                  update(index, { ...step, text: event.target.value })
                }
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={step.pressEnter}
                  onChange={(event) =>
                    update(index, {
                      ...step,
                      pressEnter: event.target.checked,
                    })
                  }
                />
                Press Enter
              </label>
            </div>
          )}

          {step.type === "delay" && (
            <input
              className={fieldClass}
              type="number"
              min={0}
              max={300_000}
              value={step.milliseconds}
              onChange={(event) =>
                update(index, {
                  ...step,
                  milliseconds: Number(event.target.value),
                })
              }
              aria-label="Delay milliseconds"
            />
          )}

          {step.type === "wait" && (
            <div className="grid grid-cols-2 gap-2">
              <input
                className={`${fieldClass} col-span-2 font-mono`}
                placeholder="Regular expression"
                value={step.pattern}
                onChange={(event) =>
                  update(index, { ...step, pattern: event.target.value })
                }
              />
              <input
                className={fieldClass}
                type="number"
                min={100}
                max={300_000}
                value={step.timeoutMs}
                onChange={(event) =>
                  update(index, {
                    ...step,
                    timeoutMs: Number(event.target.value),
                  })
                }
                aria-label="Timeout milliseconds"
              />
              <select
                className={fieldClass}
                value={step.onTimeout}
                onChange={(event) =>
                  update(index, {
                    ...step,
                    onTimeout: event.target.value as "stop" | "continue",
                  })
                }
              >
                <option value="stop">Stop on timeout</option>
                <option value="continue">Continue on timeout</option>
              </select>
            </div>
          )}

          {step.type === "if" && (
            <div className="space-y-3">
              <input
                className={`${fieldClass} font-mono`}
                placeholder="Regex tested against captured output"
                value={step.pattern}
                onChange={(event) =>
                  update(index, { ...step, pattern: event.target.value })
                }
              />
              <div className="border-l-2 border-emerald-500/40 pl-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-emerald-500">
                  Match
                </div>
                <StepList
                  steps={step.then}
                  depth={depth + 1}
                  onChange={(then) => update(index, { ...step, then })}
                />
              </div>
              <div className="border-l-2 border-amber-500/40 pl-2">
                <div className="mb-1 text-[10px] font-semibold uppercase text-amber-500">
                  No match
                </div>
                <StepList
                  steps={step.else}
                  depth={depth + 1}
                  onChange={(elseSteps) =>
                    update(index, { ...step, else: elseSteps })
                  }
                />
              </div>
            </div>
          )}

          {step.type === "repeat" && (
            <div className="space-y-2">
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={100}
                value={step.count}
                onChange={(event) =>
                  update(index, { ...step, count: Number(event.target.value) })
                }
                aria-label="Repeat count"
              />
              <StepList
                steps={step.steps}
                depth={depth + 1}
                onChange={(nested) => update(index, { ...step, steps: nested })}
              />
            </div>
          )}
        </div>
      ))}

      {depth < 4 && (
        <div className="flex flex-wrap gap-1">
          {(["send", "delay", "wait", "if", "repeat"] as const).map((type) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[10px]"
              onClick={() => onChange([...steps, createStep(type)])}
            >
              <Plus className="mr-1 size-3" /> {type}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MacrosPanel({
  terminalTabs,
  activeTabId,
  storageMode,
}: {
  terminalTabs: Tab[];
  activeTabId: string;
  storageMode: "local" | "cloud";
}) {
  const [macros, setMacros] = useState<TerminalMacro[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<TerminalMacro | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const load =
      storageMode === "local"
        ? Promise.resolve(
            parseTerminalMacros(localStorage.getItem("terminalMacros")),
          )
        : getUserPreferences().then((preferences) =>
            parseTerminalMacros(preferences.terminalMacros),
          );
    load
      .then((loaded) => {
        setMacros(loaded);
        setSelectedId(loaded[0]?.id ?? "");
        setDraft(loaded[0] ? structuredClone(loaded[0]) : null);
      })
      .catch(() => toast.error("Failed to load macros"));
    return () => abortRef.current?.abort();
  }, [storageMode]);

  const target = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0],
    [activeTabId, terminalTabs],
  );

  const select = (macro: TerminalMacro) => {
    setSelectedId(macro.id);
    setDraft(structuredClone(macro));
  };

  const createMacro = () => {
    const now = new Date().toISOString();
    const macro: TerminalMacro = {
      id: id(),
      name: "New macro",
      description: "",
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    setSelectedId(macro.id);
    setDraft(macro);
  };

  const persist = async (next: TerminalMacro[]) => {
    const serialized = JSON.stringify(next);
    if (storageMode === "local")
      localStorage.setItem("terminalMacros", serialized);
    else await saveUserPreferences({ terminalMacros: serialized });
    setMacros(next);
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    const saved = {
      ...draft,
      name: draft.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    const next = macros.some((macro) => macro.id === saved.id)
      ? macros.map((macro) => (macro.id === saved.id ? saved : macro))
      : [...macros, saved];
    await persist(next);
    setDraft(saved);
    toast.success("Macro saved");
  };

  const remove = async () => {
    if (!draft) return;
    const next = macros.filter((macro) => macro.id !== draft.id);
    await persist(next);
    setSelectedId(next[0]?.id ?? "");
    setDraft(next[0] ? structuredClone(next[0]) : null);
  };

  const run = async () => {
    const terminal = target?.terminalRef?.current;
    if (!draft || !terminal?.sendInput || !terminal.subscribeOutput) {
      toast.error("Open and connect a terminal first");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      await runTerminalMacro(
        draft,
        {
          send: terminal.sendInput,
          subscribe: terminal.subscribeOutput,
        },
        { signal: controller.signal },
      );
      toast.success("Macro completed");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "Macro failed");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Braces className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Macros</div>
          <div className="truncate text-[10px] text-muted-foreground">
            Target: {target?.label ?? "No terminal"}
          </div>
        </div>
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          onClick={createMacro}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <select
          className={`${fieldClass} mb-3`}
          value={selectedId}
          onChange={(event) => {
            const macro = macros.find((item) => item.id === event.target.value);
            if (macro) select(macro);
          }}
        >
          <option value="">Select a macro</option>
          {macros.map((macro) => (
            <option key={macro.id} value={macro.id}>
              {macro.name}
            </option>
          ))}
        </select>

        {!draft ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Create a macro to automate an interactive terminal flow.
          </div>
        ) : (
          <div className="space-y-3">
            <input
              className={fieldClass}
              value={draft.name}
              placeholder="Macro name"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            <textarea
              className={`${fieldClass} min-h-14 py-2`}
              value={draft.description ?? ""}
              placeholder="Description"
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
            <StepList
              steps={draft.steps}
              onChange={(steps) => setDraft({ ...draft, steps })}
            />
            <div className="flex gap-2 border-t border-border pt-3">
              <Button size="sm" variant="destructive" onClick={remove}>
                <Trash2 className="mr-1 size-3" /> Delete
              </Button>
              <Button size="sm" variant="outline" onClick={save}>
                <Save className="mr-1 size-3" /> Save
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                onClick={running ? () => abortRef.current?.abort() : run}
              >
                {running ? (
                  <Square className="mr-1 size-3" />
                ) : (
                  <Play className="mr-1 size-3" />
                )}
                {running ? "Stop" : "Run"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
