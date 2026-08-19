import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { Textarea } from "@/components/textarea";
import { Switch } from "@/components/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import type { Step, StepType } from "@/types/automations";
import { HostSelectorField } from "./HostSelectorField";
import type { AutomationEditorOptions } from "./editor-types";

const STEP_TYPES: StepType[] = [
  "notify",
  "http",
  "run_command",
  "run_snippet",
  "docker",
  "tunnel",
  "wol",
  "wait",
  "set_var",
  "if",
  "stop",
];

interface StepBlockProps {
  step: Step;
  index: number;
  total: number;
  depth: number;
  options: AutomationEditorOptions;
  onChange: (next: Step) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  renderNested: (
    steps: Step[],
    onChange: (next: Step[]) => void,
    depth: number,
  ) => React.ReactNode;
}

/**
 * One block in the automation's step list. Each step type renders only the
 * fields it actually uses, so the form stays readable as more types are added.
 */
export function StepBlock({
  step,
  index,
  total,
  depth,
  options,
  onChange,
  onRemove,
  onMove,
  renderNested,
}: StepBlockProps) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";

  function patch(changes: Partial<Step>) {
    onChange({ ...step, ...changes } as Step);
  }

  return (
    <div
      className={`border border-border p-3 ${depth > 0 ? "border-l-2 border-l-primary/40" : ""}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Select
          value={step.type}
          onValueChange={(value) =>
            onChange(changeStepType(step, value as StepType))
          }
        >
          <SelectTrigger
            size="sm"
            className="flex-1 rounded-none border-border"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STEP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`${base}.stepTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={index === 0}
          title={t(`${base}.moveUp`)}
          onClick={() => onMove(-1)}
        >
          <ChevronUp size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={index === total - 1}
          title={t(`${base}.moveDown`)}
          onClick={() => onMove(1)}
        >
          <ChevronDown size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          title={t(`${base}.removeStep`)}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div className="space-y-3">
        {step.type === "notify" && (
          <>
            <Field label={t(`${base}.fields.title`)}>
              <Input
                className="h-8 rounded-none border-border"
                value={step.title ?? ""}
                onChange={(e) =>
                  patch({ title: e.target.value } as Partial<Step>)
                }
              />
            </Field>
            <Field label={t(`${base}.fields.message`)}>
              <Textarea
                className="rounded-none border-border min-h-16"
                value={step.body ?? ""}
                onChange={(e) =>
                  patch({ body: e.target.value } as Partial<Step>)
                }
              />
            </Field>
            <Field label={t(`${base}.fields.channels`)}>
              <div className="flex flex-wrap gap-2">
                {options.channels.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t(`${base}.noChannelsHint`)}
                  </span>
                )}
                {options.channels.map((channel) => {
                  const checked = step.channelIds?.includes(channel.id);
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() =>
                        patch({
                          channelIds: checked
                            ? step.channelIds.filter((id) => id !== channel.id)
                            : [...(step.channelIds ?? []), channel.id],
                        } as Partial<Step>)
                      }
                      className={`px-2 py-1 text-xs border ${
                        checked
                          ? "border-primary text-foreground"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {channel.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {step.type === "http" && (
          <>
            <div className="flex gap-2">
              <Select
                value={step.method}
                onValueChange={(value) =>
                  patch({ method: value } as Partial<Step>)
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-28 rounded-none border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1 rounded-none border-border"
                placeholder="https://"
                value={step.url ?? ""}
                onChange={(e) =>
                  patch({ url: e.target.value } as Partial<Step>)
                }
              />
            </div>
            <Field label={t(`${base}.fields.body`)}>
              <Textarea
                className="rounded-none border-border min-h-16 font-mono text-xs"
                value={step.body ?? ""}
                onChange={(e) =>
                  patch({ body: e.target.value } as Partial<Step>)
                }
              />
            </Field>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Switch
                checked={!!step.allowPrivateNetwork}
                onCheckedChange={(checked) =>
                  patch({ allowPrivateNetwork: checked } as Partial<Step>)
                }
              />
              <span>
                {t(`${base}.fields.allowPrivateNetwork`)}
                <span className="block">
                  {t(`${base}.fields.allowPrivateNetworkHint`)}
                </span>
              </span>
            </label>
          </>
        )}

        {step.type === "run_command" && (
          <>
            <HostSelectorField
              value={step.hostSelector}
              options={options}
              onChange={(hostSelector) =>
                patch({ hostSelector } as Partial<Step>)
              }
            />
            <Field label={t(`${base}.fields.command`)}>
              <Textarea
                className="rounded-none border-border min-h-16 font-mono text-xs"
                value={step.command ?? ""}
                onChange={(e) =>
                  patch({ command: e.target.value } as Partial<Step>)
                }
              />
            </Field>
            <ElevatedToggle
              checked={!!step.elevated}
              onChange={(elevated) => patch({ elevated } as Partial<Step>)}
            />
          </>
        )}

        {step.type === "run_snippet" && (
          <>
            <HostSelectorField
              value={step.hostSelector}
              options={options}
              onChange={(hostSelector) =>
                patch({ hostSelector } as Partial<Step>)
              }
            />
            <Field label={t(`${base}.fields.snippet`)}>
              <Select
                value={step.snippetId ? String(step.snippetId) : ""}
                onValueChange={(value) =>
                  patch({ snippetId: Number(value) } as Partial<Step>)
                }
              >
                <SelectTrigger size="sm" className="rounded-none border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.snippets.map((snippet) => (
                    <SelectItem key={snippet.id} value={String(snippet.id)}>
                      {snippet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ElevatedToggle
              checked={!!step.elevated}
              onChange={(elevated) => patch({ elevated } as Partial<Step>)}
            />
          </>
        )}

        {step.type === "docker" && (
          <>
            <HostSelectorField
              value={step.hostSelector}
              options={options}
              onChange={(hostSelector) =>
                patch({ hostSelector } as Partial<Step>)
              }
            />
            <div className="flex gap-2">
              <Select
                value={step.action}
                onValueChange={(value) =>
                  patch({ action: value } as Partial<Step>)
                }
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-0 flex-1 rounded-none border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["start", "stop", "restart"].map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1 rounded-none border-border"
                placeholder={t(`${base}.fields.container`)}
                value={step.container ?? ""}
                onChange={(e) =>
                  patch({ container: e.target.value } as Partial<Step>)
                }
              />
            </div>
          </>
        )}

        {step.type === "tunnel" && (
          <div className="flex gap-2">
            <Select
              value={step.action}
              onValueChange={(value) =>
                patch({ action: value } as Partial<Step>)
              }
            >
              <SelectTrigger
                size="sm"
                className="min-w-0 flex-1 rounded-none border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="connect">connect</SelectItem>
                <SelectItem value="disconnect">disconnect</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-8 flex-1 rounded-none border-border"
              value={step.tunnelName ?? ""}
              onChange={(e) =>
                patch({ tunnelName: e.target.value } as Partial<Step>)
              }
            />
          </div>
        )}

        {step.type === "wol" && (
          <Field label={t(`${base}.fields.host`)}>
            <Select
              value={step.hostId ? String(step.hostId) : ""}
              onValueChange={(value) =>
                patch({ hostId: Number(value) } as Partial<Step>)
              }
            >
              <SelectTrigger size="sm" className="rounded-none border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.hosts.map((host) => (
                  <SelectItem key={host.id} value={String(host.id)}>
                    {host.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {step.type === "wait" && (
          <Field label={t(`${base}.fields.seconds`)}>
            <Input
              type="number"
              min={1}
              className="h-8 w-32 rounded-none border-border"
              value={step.seconds ?? 0}
              onChange={(e) =>
                patch({ seconds: Number(e.target.value) } as Partial<Step>)
              }
            />
          </Field>
        )}

        {step.type === "set_var" && (
          <div className="flex gap-2">
            <Input
              className="h-8 w-40 rounded-none border-border"
              placeholder={t(`${base}.fields.variableName`)}
              value={step.name ?? ""}
              onChange={(e) => patch({ name: e.target.value } as Partial<Step>)}
            />
            <Input
              className="h-8 flex-1 rounded-none border-border"
              placeholder={t(`${base}.fields.variableValue`)}
              value={step.value ?? ""}
              onChange={(e) =>
                patch({ value: e.target.value } as Partial<Step>)
              }
            />
          </div>
        )}

        {step.type === "if" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                className="h-8 flex-1 rounded-none border-border font-mono text-xs"
                placeholder={t(`${base}.fields.conditionLeftPlaceholder`)}
                value={step.condition?.left ?? ""}
                onChange={(e) =>
                  patch({
                    condition: { ...step.condition, left: e.target.value },
                  } as Partial<Step>)
                }
              />
              <Select
                value={step.condition?.operator ?? "=="}
                onValueChange={(value) =>
                  patch({
                    condition: { ...step.condition, operator: value },
                  } as Partial<Step>)
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-28 rounded-none border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[">", "<", ">=", "<=", "==", "!=", "contains"].map((op) => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1 rounded-none border-border font-mono text-xs"
                placeholder={t(`${base}.fields.conditionRightPlaceholder`)}
                value={step.condition?.right ?? ""}
                onChange={(e) =>
                  patch({
                    condition: { ...step.condition, right: e.target.value },
                  } as Partial<Step>)
                }
              />
            </div>
            {renderNested(
              step.then ?? [],
              (next) => patch({ then: next } as Partial<Step>),
              depth + 1,
            )}
          </div>
        )}

        {step.type !== "stop" && (
          <Field label={t(`${base}.fields.onError`)}>
            <Select
              value={step.onError ?? "stop"}
              onValueChange={(value) =>
                patch({ onError: value } as Partial<Step>)
              }
            >
              <SelectTrigger
                size="sm"
                className="min-w-0 w-full rounded-none border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stop">
                  {t(`${base}.onError.stop`)}
                </SelectItem>
                <SelectItem value="continue">
                  {t(`${base}.onError.continue`)}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ElevatedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={checked} onCheckedChange={onChange} />
      {t("newUi.sidebar.automations.fields.elevated")}
    </label>
  );
}

/** Keeps the step id when the type changes, so run history stays linked. */
function changeStepType(step: Step, type: StepType): Step {
  const next: Record<string, unknown> = { id: step.id, type };
  switch (type) {
    case "notify":
      next.channelIds = [];
      break;
    case "http":
      next.method = "POST";
      next.url = "";
      break;
    case "run_command":
      next.command = "";
      next.hostSelector = { kind: "trigger" };
      break;
    case "run_snippet":
      next.hostSelector = { kind: "trigger" };
      break;
    case "docker":
      next.action = "restart";
      next.container = "";
      next.hostSelector = { kind: "trigger" };
      break;
    case "tunnel":
      next.action = "connect";
      next.tunnelName = "";
      break;
    case "wait":
      next.seconds = 30;
      break;
    case "set_var":
      next.name = "";
      next.value = "";
      break;
    case "if":
      next.condition = { left: "", operator: "==", right: "" };
      next.then = [];
      break;
    default:
      break;
  }
  return next as unknown as Step;
}
