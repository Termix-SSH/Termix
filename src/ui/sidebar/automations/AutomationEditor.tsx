import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { Switch } from "@/components/switch";
import type { AutomationDefinition, Step } from "@/types/automations";
import { AUTOMATION_DEFINITION_VERSION } from "@/types/automations";
import { StepBlock } from "./StepBlock";
import { TriggerCard, defaultTrigger } from "./TriggerCard";
import { newStepId, type AutomationEditorOptions } from "./editor-types";

export interface AutomationDraft {
  name: string;
  description: string;
  enabled: boolean;
  definition: AutomationDefinition;
}

export function emptyDraft(): AutomationDraft {
  return {
    name: "",
    description: "",
    enabled: true,
    definition: {
      version: AUTOMATION_DEFINITION_VERSION,
      trigger: defaultTrigger("metric_threshold"),
      steps: [],
    },
  };
}

/**
 * The automation builder: one trigger, then an ordered list of steps that can
 * nest through if/otherwise. A JSON view is available for anything the form
 * does not cover yet.
 */
export function AutomationEditor({
  draft,
  options,
  onChange,
}: {
  draft: AutomationDraft;
  options: AutomationEditorOptions;
  onChange: (next: AutomationDraft) => void;
}) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";
  const [view, setView] = useState<"builder" | "json">("builder");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  function setDefinition(definition: AutomationDefinition) {
    onChange({ ...draft, definition });
  }

  function setSteps(steps: Step[]) {
    setDefinition({ ...draft.definition, steps });
  }

  function renderSteps(
    steps: Step[],
    onStepsChange: (next: Step[]) => void,
    depth: number,
  ): React.ReactNode {
    return (
      <div className="space-y-2">
        {steps.map((step, index) => (
          <StepBlock
            key={step.id}
            step={step}
            index={index}
            total={steps.length}
            depth={depth}
            options={options}
            onChange={(next) => {
              const copy = [...steps];
              copy[index] = next;
              onStepsChange(copy);
            }}
            onRemove={() => onStepsChange(steps.filter((_, i) => i !== index))}
            onMove={(direction) => {
              const target = index + direction;
              if (target < 0 || target >= steps.length) return;
              const copy = [...steps];
              [copy[index], copy[target]] = [copy[target], copy[index]];
              onStepsChange(copy);
            }}
            renderNested={renderSteps}
          />
        ))}

        <Button
          variant="outline"
          size="sm"
          className="rounded-none w-full border-border"
          onClick={() =>
            onStepsChange([
              ...steps,
              { id: newStepId(), type: "notify", channelIds: [] } as Step,
            ])
          }
        >
          <Plus size={14} className="mr-1" />
          {t(`${base}.addStep`)}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {t(`${base}.nameLabel`)}
        </Label>
        <Input
          className="h-8 rounded-none"
          placeholder={t(`${base}.namePlaceholder`)}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
        />
        {t(`${base}.enabledLabel`)}
      </label>

      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className={`rounded-none ${
            view === "builder"
              ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand hover:bg-accent-brand/20 hover:text-accent-brand"
              : "border-border"
          }`}
          onClick={() => setView("builder")}
        >
          {t(`${base}.viewBuilder`)}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`rounded-none ${
            view === "json"
              ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand hover:bg-accent-brand/20 hover:text-accent-brand"
              : "border-border"
          }`}
          onClick={() => {
            setJsonText(JSON.stringify(draft.definition, null, 2));
            setJsonError(null);
            setView("json");
          }}
        >
          {t(`${base}.viewJson`)}
        </Button>
      </div>

      {view === "builder" ? (
        <>
          <TriggerCard
            trigger={draft.definition.trigger}
            options={options}
            onChange={(trigger) =>
              setDefinition({ ...draft.definition, trigger })
            }
          />

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              {t(`${base}.steps`)}
            </Label>
            {draft.definition.steps.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(`${base}.noSteps`)}
              </p>
            )}
            {renderSteps(draft.definition.steps, setSteps, 0)}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <textarea
            className="w-full min-h-64 bg-background border border-border p-2 font-mono text-xs"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value);
                setDefinition(parsed as AutomationDefinition);
                setJsonError(null);
              } catch (error) {
                setJsonError(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
        </div>
      )}
    </div>
  );
}
