import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import type { OnboardingStepProps } from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { PluginIconBox } from "@/plugins/plugin-bits";
import {
  applyOnboardingPlugins,
  getOnboardingPlugins,
  type OnboardingPluginInfo,
  type OnboardingPluginList,
  type PluginChoice,
} from "@/api/plugins-api";
import { syncPlugins } from "@/plugin-host/loader";
import { resolvePluginChoices } from "@/types/plugin-onboarding";
import { useOnboardingStage } from "../onboarding-stage-context";
import {
  currentChoice,
  defaultChoices,
  recommendedChoices,
} from "../plugin-choices";
import { DocsLink } from "@/components/docs-link";

const CATEGORY_ORDER = [
  "Terminal",
  "Files & Transfer",
  "Infrastructure",
  "Monitoring",
  "Networking",
  "Access & Security",
  "Productivity",
];

const CHOICES: PluginChoice[] = ["enabled", "disabled", "remove"];
const RANK: Record<PluginChoice, number> = {
  remove: 0,
  disabled: 1,
  enabled: 2,
};

export function PluginsStep({
  setCanContinue,
  setBeforeNext,
}: OnboardingStepProps) {
  const { t } = useTranslation();
  const stage = useOnboardingStage();
  const [list, setList] = useState<OnboardingPluginList | null>(
    stage?.plugins ?? null,
  );
  const [loadError, setLoadError] = useState(false);
  const [choices, setChoices] = useState<Record<string, PluginChoice>>(() =>
    stage?.plugins ? defaultChoices(stage.plugins) : {},
  );
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState<{ id: string; error: string }[]>([]);

  useEffect(() => {
    if (list) return;
    let cancelled = false;
    getOnboardingPlugins()
      .then((next) => {
        if (cancelled) return;
        setList(next);
        setChoices(defaultChoices(next));
        stage?.setPlugins(next);
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [list, stage]);

  const resolved = useMemo(() => {
    if (!list) return null;
    return resolvePluginChoices(
      list.plugins.map((p) => ({ id: p.id, dependencies: p.dependencies })),
      choices,
    );
  }, [list, choices]);

  const names = useMemo(
    () => new Map(list?.plugins.map((p) => [p.id, p.name]) ?? []),
    [list],
  );

  const changed = useMemo(() => {
    if (!list || !resolved) return false;
    if (list.pending) return true;
    return list.plugins.some(
      (plugin) => resolved.choices[plugin.id] !== currentChoice(plugin),
    );
  }, [list, resolved]);

  const apply = useCallback(async (): Promise<boolean> => {
    if (!list || !resolved) return !!loadError;
    if (!changed) return true;
    setApplying(true);
    setFailed([]);
    try {
      const result = await applyOnboardingPlugins(resolved.choices);
      await syncPlugins().catch(() => {});
      // Start again from how things are now, so going back and on again
      // does not apply twice, and a failure only stops Next once.
      const fresh = await getOnboardingPlugins().catch(() => null);
      const next = fresh ?? { ...list, pending: false };
      setList(next);
      setChoices(defaultChoices(next));
      stage?.setPlugins(next);
      if (result.failed.length > 0) {
        setFailed(result.failed);
        return false;
      }
      return true;
    } catch {
      setFailed([{ id: "", error: t("onboarding.pluginsApplyFailed") }]);
      return false;
    } finally {
      setApplying(false);
    }
  }, [list, resolved, changed, loadError, stage, t]);

  useEffect(() => {
    setBeforeNext(apply);
    return () => setBeforeNext(null);
  }, [apply, setBeforeNext]);

  useEffect(() => {
    setCanContinue(!!list || loadError);
  }, [list, loadError, setCanContinue]);

  if (loadError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("onboarding.pluginsLoadFailed")}
      </p>
    );
  }

  if (!list || !resolved) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  const regular = list.plugins.filter((p) => !p.consent);
  const consent = list.plugins.filter((p) => p.consent);
  const groups = new Map<string, OnboardingPluginInfo[]>();
  for (const plugin of regular) {
    const group = groups.get(plugin.category) ?? [];
    group.push(plugin);
    groups.set(plugin.category, group);
  }
  const orderedGroups = [...groups.entries()].sort(
    ([a], [b]) =>
      (CATEGORY_ORDER.indexOf(a) + 1 || 99) -
      (CATEGORY_ORDER.indexOf(b) + 1 || 99),
  );

  const counts = { enabled: 0, disabled: 0, remove: 0 };
  for (const plugin of list.plugins) counts[resolved.choices[plugin.id]]++;
  const forcedBy = new Map(
    resolved.adjustments.map((a) => [
      a.id,
      a.requiredBy.map((id) => names.get(id) ?? id).join(", "),
    ]),
  );

  const setChoice = (id: string, choice: PluginChoice) =>
    setChoices((prev) => ({ ...prev, [id]: choice }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.pluginsIntro")}{" "}
        <DocsLink core="pluginCatalog" className="text-xs">
          {t("onboarding.pluginsDocsLink")}
        </DocsLink>
      </p>

      <div className="flex items-start gap-2 border border-border bg-muted/30 p-2.5 text-[11px] leading-snug text-muted-foreground">
        <Info size={13} className="mt-0.5 shrink-0 text-accent-brand" />
        <span>
          {list.reason === "upgrade" && (
            <>{t("onboarding.pluginsUpgradeNote")} </>
          )}
          {t("onboarding.pluginsRemoveNote")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => setChoices(recommendedChoices(list))}
          >
            {t("onboarding.pluginsUseRecommended")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              setChoices(
                Object.fromEntries(list.plugins.map((p) => [p.id, "enabled"])),
              )
            }
          >
            {t("onboarding.pluginsEnableAll")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              setChoices(
                Object.fromEntries(
                  list.plugins.map((p) => [
                    p.id,
                    p.consent ? choices[p.id] : "disabled",
                  ]),
                ),
              )
            }
          >
            {t("onboarding.pluginsDisableAll")}
          </Button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {t("onboarding.pluginsCounts", {
            enabled: counts.enabled,
            disabled: counts.disabled,
            removed: counts.remove,
          })}
        </span>
      </div>

      {orderedGroups.map(([category, plugins]) => (
        <div key={category} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {category}
          </span>
          {plugins.map((plugin) => {
            const choice = resolved.choices[plugin.id];
            const floor = forcedBy.has(plugin.id) ? RANK[choice] : 0;
            return (
              <div
                key={plugin.id}
                className="flex flex-col gap-2 border border-border bg-card p-2.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <PluginIconBox
                    name={plugin.icon ?? undefined}
                    size="sm"
                    muted={choice === "remove"}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      {plugin.name}
                      {plugin.recommended && (
                        <span className="border border-accent-brand/40 px-1 text-[9px] font-semibold uppercase tracking-wider text-accent-brand">
                          {t("onboarding.pluginsRecommended")}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] leading-snug text-muted-foreground">
                      {plugin.description}
                    </span>
                    {forcedBy.has(plugin.id) && (
                      <span className="text-[10px] text-accent-brand">
                        {t("onboarding.pluginsKeptBecause", {
                          names: forcedBy.get(plugin.id),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div
                  role="radiogroup"
                  aria-label={plugin.name}
                  className="flex shrink-0 border border-border"
                >
                  {CHOICES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={choice === option}
                      disabled={RANK[option] < floor}
                      onClick={() => setChoice(plugin.id, option)}
                      className={`px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        choice === option
                          ? option === "remove"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-accent-brand/15 text-accent-brand"
                          : "text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {t(`onboarding.pluginsChoice_${option}`)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {consent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("onboarding.pluginsConsentTitle")}
          </span>
          {consent.map((plugin) => {
            const on = resolved.choices[plugin.id] === "enabled";
            return (
              <label
                key={plugin.id}
                className="flex cursor-pointer items-start gap-2.5 border border-border bg-card p-2.5"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent-brand)]"
                  checked={on}
                  disabled={forcedBy.has(plugin.id)}
                  onChange={(e) =>
                    setChoice(
                      plugin.id,
                      e.target.checked ? "enabled" : "disabled",
                    )
                  }
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{plugin.name}</span>
                  <span className="text-[10px] leading-snug text-muted-foreground">
                    {plugin.description}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    {t("onboarding.pluginsConsentNote")}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {applying && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t("onboarding.pluginsApplying")}
        </div>
      )}

      {failed.length > 0 && (
        <div className="flex flex-col gap-1 border border-destructive/40 bg-destructive/10 p-2.5 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle size={13} />
            {t("onboarding.pluginsSomeFailed")}
          </span>
          {failed.map((f) => (
            <span key={`${f.id}:${f.error}`} className="text-muted-foreground">
              {f.id ? `${names.get(f.id) ?? f.id}: ${f.error}` : f.error}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
