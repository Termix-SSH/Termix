import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  LayoutTemplate,
  Palette,
  History,
  Power,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/button";
import { ListRow } from "@/components/list-kit";
import { InlineView, SurfaceScope } from "@/components/surface/surface-scope";
import { useTheme } from "@/components/theme-provider";
import { usePermissions } from "@/hooks/use-permissions";
import { PluginConsentPrompt } from "@/plugins/PluginConsentPrompt";
import { usePluginsManager } from "@/plugins/use-plugins-manager";
import { PluginIconBox } from "@/plugins/plugin-bits";
import { getPluginRecord } from "@/plugin-host/plugin-store";
import { restoreBundledPlugin } from "@/api/plugins-api";
import { ShellConfirmCapture } from "@/shell/controller/ShellControllerProvider";
import {
  chooseDefaultLook,
  chooseLayout,
  chooseThemeForAccount,
} from "./look-store";
import { layoutLabel, useLayouts } from "./layout-registry";
import { themeLabel, useThemes } from "./theme-registry";
import { useChooseTheme } from "./use-look-theme";
import type { LayoutStatus } from "./layout-status";

type RepairStatus = Extract<LayoutStatus, { kind: "repair" }>;

const LOOK_CAPABILITIES = ["ui:layout", "ui:theme"];

/**
 * What an admin can do about a broken layout: update or disable its plugin,
 * and install another layout or theme. Uses the Plugins tab's own flows.
 */
function AdminTools({
  status,
  installOpen,
  setInstallOpen,
  onRetry,
}: {
  status: RepairStatus;
  installOpen: boolean;
  setInstallOpen: (open: boolean) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const manager = usePluginsManager();
  const entry = status.pluginId
    ? manager.plugins.find((plugin) => plugin.id === status.pluginId)
    : undefined;
  const installable = manager.plugins.filter(
    (plugin) =>
      !plugin.installed &&
      plugin.versions[0]?.capabilities?.some((capability) =>
        LOOK_CAPABILITIES.includes(capability),
      ),
  );

  return (
    <>
      {entry?.installed && entry.updateAvailable && entry.latestVersion && (
        <Button
          size="sm"
          onClick={() => void manager.requestUpdate(entry)}
          disabled={manager.busy.has(entry.id)}
        >
          <Download />
          {t("looks.repair.update", {
            name: entry.name,
            version: entry.latestVersion,
          })}
        </Button>
      )}
      {entry?.installed && entry.enabled && !entry.managedByServer && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void manager.toggle(entry)}
          disabled={manager.busy.has(entry.id)}
        >
          <Power />
          {t("looks.repair.disable", { name: entry.name })}
        </Button>
      )}
      {entry?.installed && entry.bundled && !entry.managedByServer && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void restoreBundledPlugin(entry.id)
              .then(onRetry)
              .catch(() => toast.error(t("looks.repair.restoreFailed")));
          }}
          disabled={manager.busy.has(entry.id)}
        >
          <History />
          {t("looks.repair.restore", { name: entry.name })}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setInstallOpen(true)}>
        <Download />
        {t("looks.repair.install")}
      </Button>

      <InlineView
        open={installOpen}
        onOpenChange={setInstallOpen}
        title={t("looks.repair.installTitle")}
        icon={<LayoutTemplate className="size-3.5" />}
      >
        <div className="flex flex-col">
          {manager.loading && (
            <p className="p-3 text-xs text-muted-foreground">
              {t("common.loading")}
            </p>
          )}
          {!manager.loading && installable.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">
              {manager.registryError
                ? t("looks.repair.registryUnreachable")
                : t("looks.repair.nothingToInstall")}
            </p>
          )}
          {installable.map((plugin, index) => (
            <ListRow
              key={`${plugin.registryId ?? ""}:${plugin.id}`}
              stripe={index}
              icon={<PluginIconBox name={plugin.icon} size="sm" />}
              title={plugin.name}
              meta={plugin.description}
              trailing={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={manager.busy.has(plugin.id)}
                  onClick={() => manager.requestInstall(plugin)}
                >
                  {t("looks.repair.installButton")}
                </Button>
              }
            />
          ))}
        </div>
      </InlineView>

      <PluginConsentPrompt
        request={manager.consent}
        onCancel={() => manager.setConsent(null)}
        onConfirm={() => void manager.confirmConsent()}
      />
    </>
  );
}

/**
 * Shown instead of a layout that cannot be drawn. Small on purpose: it has
 * to work when everything else is broken, and gets people back to a working
 * look in one click.
 */
export function RepairView({
  status,
  onRetry,
}: {
  status: RepairStatus;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { isAdmin } = usePermissions();
  const { theme } = useTheme();
  const chooseTheme = useChooseTheme();
  const layouts = useLayouts();
  const themes = useThemes();
  const [copied, setCopied] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const record = status.pluginId ? getPluginRecord(status.pluginId) : null;
  const layoutName =
    layouts.find((layout) => layout.id === status.layoutId) ?? null;
  const name = layoutName
    ? layoutLabel(layoutName, t)
    : status.layoutId || t("looks.repair.noLayout");
  const details = [
    `${t("looks.repair.layout")}: ${name} (${status.layoutId})`,
    status.pluginId
      ? `${t("looks.repair.plugin")}: ${record?.summary.name ?? status.pluginId} ${status.version ?? ""}`.trim()
      : null,
    `${t("looks.repair.reason")}: ${t(`looks.repair.reasons.${status.reason}`)}`,
    status.error ? `${t("looks.repair.error")}: ${status.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("looks.repair.copyFailed"));
    }
  };

  const run = (action: () => Promise<void>) => () =>
    void action().catch(() => toast.error(t("looks.repair.saveFailed")));

  const resetOwn = run(async () => {
    try {
      localStorage.removeItem("vite-ui-theme");
    } catch {
      // Private mode.
    }
    await chooseThemeForAccount(null);
    await chooseLayout(null);
  });

  const resetForEveryone = run(() =>
    chooseDefaultLook({ layout: null, theme: null }),
  );

  const safe = status.reason === "safe-url" || status.reason === "safe-env";

  return (
    <SurfaceScope kind="tab" className="h-dvh w-screen bg-background">
      <ShellConfirmCapture />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-10">
        <div className="flex w-full max-w-xl flex-col gap-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted">
              <TriangleAlert className="size-4 text-warning" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-sm font-semibold text-foreground">
                {safe ? t("looks.repair.safeTitle") : t("looks.repair.title")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t(`looks.repair.reasons.${status.reason}`)}
              </p>
            </div>
          </div>

          <div className="flex flex-col border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
              <span className="truncate text-xs text-foreground">
                {name}
                {status.pluginId && (
                  <span className="text-muted-foreground">
                    {" | "}
                    {record?.summary.name ?? status.pluginId}
                    {status.version ? ` ${status.version}` : ""}
                  </span>
                )}
              </span>
              <Button size="xs" variant="ghost" onClick={() => void copy()}>
                {copied ? <Check /> : <Copy />}
                {copied ? t("looks.repair.copied") : t("looks.repair.copy")}
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {status.error ?? t("looks.repair.noError")}
            </pre>
          </div>

          <div className="flex flex-wrap gap-2">
            {!safe && (
              <Button size="sm" onClick={onRetry}>
                <RefreshCw />
                {t("looks.repair.retry")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={resetOwn}>
              <RotateCcw />
              {t("looks.repair.reset")}
            </Button>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={resetForEveryone}>
                <RotateCcw />
                {t("looks.repair.resetEveryone")}
              </Button>
            )}
            {isAdmin && (
              <AdminTools
                status={status}
                installOpen={installOpen}
                setInstallOpen={setInstallOpen}
                onRetry={onRetry}
              />
            )}
          </div>

          {!isAdmin && (
            <p className="border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("looks.repair.askAdmin")}
            </p>
          )}

          <section className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <LayoutTemplate className="size-3" />
              {t("looks.repair.switchLayout")}
            </h2>
            <div className="flex flex-col border border-border">
              {layouts.map((layout, index) => (
                <ListRow
                  key={layout.id}
                  stripe={index}
                  title={layoutLabel(layout, t)}
                  meta={layout.id}
                  selected={layout.id === status.layoutId}
                  onClick={run(() => chooseLayout(layout.id))}
                />
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Palette className="size-3" />
              {t("looks.repair.switchTheme")}
            </h2>
            <div className="flex flex-wrap gap-1">
              {themes.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={themeLabel(entry, t)}
                  aria-pressed={theme === entry.id}
                  onClick={() => chooseTheme(entry.id)}
                  className={`flex items-center gap-1.5 border px-2 py-1 text-[11px] ${theme === entry.id ? "border-accent-brand text-foreground" : "border-border text-muted-foreground hover:border-foreground/40"}`}
                >
                  <span
                    className="size-3 border border-border/60"
                    style={{ background: entry.swatch.background }}
                  />
                  {themeLabel(entry, t)}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </SurfaceScope>
  );
}
