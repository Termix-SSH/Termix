import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/button";
import { Facts } from "@/components/panel-layout";
import { PanePrompt } from "@/components/surface/surface-scope";
import { CapabilityRow, PluginIconBox } from "./plugin-bits";
import { capabilityRisk, orderByRisk, type PluginEntry } from "./plugin-model";

export interface ConsentRequest {
  plugin: PluginEntry;
  mode: "install" | "update" | "upload";
  version: string;
  /** What the prompt lists: all of them to install, only the new ones to update. */
  capabilities: string[];
  /** Set for a file uploaded in developer mode. */
  uploadToken?: string;
}

/**
 * Install and update consent. Capabilities read as consequences, worst first;
 * the low risk ones fold into one line so the list stays short enough to read.
 */
export function PluginConsentPrompt({
  request,
  busy,
  onCancel,
  onConfirm,
}: {
  request: ConsentRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (!request) return null;
  const { plugin, mode, version } = request;
  const ordered = orderByRisk(request.capabilities);
  const notable = ordered.filter((c) => capabilityRisk(c) !== "low");
  const minor = ordered.filter((c) => capabilityRisk(c) === "low");

  return (
    <PanePrompt
      open
      className="max-w-md"
      onCancel={busy ? undefined : onCancel}
      icon={<PluginIconBox name={plugin.icon} size="sm" />}
      title={
        mode === "update"
          ? t("plugins.manager.consent.updateTitle", { name: plugin.name })
          : mode === "upload"
            ? t("plugins.manager.consent.uploadTitle", { name: plugin.name })
            : t("plugins.manager.consent.installTitle", { name: plugin.name })
      }
      description={
        <Facts>
          {plugin.author && <span className="truncate">{plugin.author}</span>}
          <span className="shrink-0">
            {mode !== "install" && plugin.version
              ? t("plugins.manager.versionChange", {
                  from: plugin.version,
                  to: version,
                })
              : version}
          </span>
        </Facts>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={onConfirm}
            disabled={busy}
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
          >
            {mode === "update"
              ? t("plugins.manager.consent.agreeUpdate")
              : t("plugins.manager.install")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {mode === "upload" && (
          <div className="flex items-start gap-2 border border-warning/40 bg-warning/10 px-3 py-2">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
            <span className="text-[11px] leading-snug text-foreground">
              {t("plugins.manager.consent.uploadWarning")}
            </span>
          </div>
        )}
        {mode === "update" && (
          <p className="text-xs leading-relaxed text-foreground">
            {t("plugins.manager.consent.updateExplain")}
          </p>
        )}
        <div className="flex flex-col">
          <span className="pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {mode === "update"
              ? t("plugins.manager.consent.newInVersion")
              : t("plugins.manager.whatItCanDo")}
          </span>
          <div className="divide-y divide-border border-y border-border">
            {notable.map((capability) => (
              <CapabilityRow
                key={capability}
                capability={capability}
                className="py-2.5"
              />
            ))}
            {minor.length > 0 && (
              <div className="py-2.5 text-[11px] leading-snug text-muted-foreground">
                {t("plugins.manager.consent.minor")}
              </div>
            )}
            {ordered.length === 0 && (
              <div className="py-2.5 text-[11px] leading-snug text-muted-foreground">
                {t("plugins.manager.consent.none")}
              </div>
            )}
          </div>
        </div>
      </div>
    </PanePrompt>
  );
}
