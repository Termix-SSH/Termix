import { useTranslation } from "react-i18next";
import { Label } from "@/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import type { HostSelector } from "@/types/automations";
import type { AutomationEditorOptions } from "./editor-types";

/**
 * Picks which hosts a step acts on. "The host that triggered this" is the
 * common case, so it is offered first and used as the default.
 */
export function HostSelectorField({
  value,
  options,
  onChange,
  allowTrigger = true,
}: {
  value: HostSelector | undefined;
  options: AutomationEditorOptions;
  onChange: (next: HostSelector) => void;
  allowTrigger?: boolean;
}) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";
  const kind = value?.kind ?? (allowTrigger ? "trigger" : "host");

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        {t(`${base}.fields.host`)}
      </Label>
      <div className="flex gap-2">
        <Select
          value={kind}
          onValueChange={(next) =>
            onChange(defaultFor(next as HostSelector["kind"]))
          }
        >
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1 rounded-none border-border"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowTrigger && (
              <SelectItem value="trigger">
                {t(`${base}.hostSelector.trigger`)}
              </SelectItem>
            )}
            <SelectItem value="host">
              {t(`${base}.hostSelector.host`)}
            </SelectItem>
            <SelectItem value="fleet">
              {t(`${base}.hostSelector.fleet`)}
            </SelectItem>
            <SelectItem value="all">{t(`${base}.hostSelector.all`)}</SelectItem>
          </SelectContent>
        </Select>

        {kind === "host" && (
          <Select
            value={
              value?.kind === "host" && value.hostId ? String(value.hostId) : ""
            }
            onValueChange={(next) =>
              onChange({ kind: "host", hostId: Number(next) })
            }
          >
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1 rounded-none border-border"
            >
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
        )}

        {kind === "fleet" && (
          <Select
            value={
              value?.kind === "fleet" && value.fleetId
                ? String(value.fleetId)
                : ""
            }
            onValueChange={(next) =>
              onChange({ kind: "fleet", fleetId: Number(next) })
            }
          >
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1 rounded-none border-border"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.fleets.map((fleet) => (
                <SelectItem key={fleet.id} value={String(fleet.id)}>
                  {fleet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

function defaultFor(kind: HostSelector["kind"]): HostSelector {
  switch (kind) {
    case "host":
      return { kind: "host", hostId: 0 };
    case "fleet":
      return { kind: "fleet", fleetId: 0 };
    case "hosts":
      return { kind: "hosts", hostIds: [] };
    case "all":
      return { kind: "all" };
    default:
      return { kind: "trigger" };
  }
}
