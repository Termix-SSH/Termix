import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/button";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { usePermissions } from "@/hooks/use-permissions";
import { isElectron } from "@/lib/electron";
import {
  getOnboardingPlugins,
  type OnboardingPluginList,
} from "@/api/plugins-api";
import {
  sortSteps,
  type OnboardingCtx,
  type OnboardingMode,
  type OnboardingStepDef,
} from "./onboarding-registry";
import {
  computeFlow,
  ONBOARDING_ADMIN_PERMISSION,
  seenFor,
} from "./onboarding-flow";
import { OnboardingStageContext } from "./onboarding-stage-context";
import {
  useCanEnrollSecondFactor,
  useOnboardingStepDefs,
} from "./use-onboarding-steps";

type BeforeNext = () => boolean | Promise<boolean>;

export interface OnboardingStageProps {
  mode: OnboardingMode;
  /** The picker's plugin list, when the boot gate already fetched it. */
  initialPlugins?: OnboardingPluginList | null;
  /** False on a first run, which shows before the app shell exists. */
  shellReady: boolean;
  onDone: () => void;
  onLogout?: () => void;
}

/**
 * Onboarding as a page of its own, laid out like the settings pages: one
 * centred column with the step in a card and Back / Skip / Next under it.
 * The same stage runs a new user's first run, a partial run of steps
 * someone has not seen yet, and a rerun from settings.
 */
export function OnboardingStage({
  mode,
  initialPlugins = null,
  shellReady,
  onDone,
  onLogout,
}: OnboardingStageProps) {
  const { t } = useTranslation();
  const prefs = useUiPreferencesContext();
  const { has, loaded: permissionsLoaded } = usePermissions();
  const isAdmin = has(ONBOARDING_ADMIN_PERMISSION);
  const isDesktop = isElectron();
  const canEnroll = useCanEnrollSecondFactor();

  const [plugins, setPlugins] = useState<OnboardingPluginList | null>(
    initialPlugins,
  );

  // A rerun or a partial run opened inside the app has no list yet, and
  // whether the picker applies depends on it.
  useEffect(() => {
    if (plugins || !isAdmin) return;
    let cancelled = false;
    getOnboardingPlugins()
      .then((list) => !cancelled && setPlugins(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plugins, isAdmin]);

  const allSteps = useOnboardingStepDefs();

  const ctx = useMemo<OnboardingCtx>(
    () => ({
      mode,
      isAdmin,
      isDesktop,
      has,
      pluginSetupPending: !!plugins?.pending,
      pluginsManagedElsewhere: !!plugins?.managedByLinkedServer,
      canEnrollSecondFactor: canEnroll,
    }),
    [mode, isAdmin, isDesktop, has, plugins, canEnroll],
  );

  // What was seen when the run started. Marking steps as seen happens at the
  // end, but the run itself must not shift under the user if it changes.
  const seenAtStart = useRef(prefs?.preferences.onboarding.seen ?? {});
  // Someone carried over from an older version gets their plugins' steps
  // marked seen by the shell, not shown, so only core steps run for them.
  const coreOnly = useRef(
    mode === "partial" && !!prefs?.preferences.onboarding.baselinePending,
  );
  const sticky = useRef(new Set<string>());

  const flow = useMemo(() => {
    const candidates = coreOnly.current
      ? allSteps.filter((step) => !step.pluginId)
      : allSteps;
    const live = computeFlow(candidates, seenAtStart.current, ctx);
    for (const step of live) sticky.current.add(step.id);
    // A step that was in the run stays in it (the picker stops being
    // pending once applied), unless its plugin went away.
    const kept = allSteps.filter(
      (step) =>
        sticky.current.has(step.id) && !live.some((s) => s.id === step.id),
    );
    return sortSteps([...live, ...kept]);
  }, [allSteps, ctx]);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const lastPosition = useRef(0);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [canContinue, setCanContinueMap] = useState<Record<string, boolean>>(
    {},
  );
  const beforeNext = useRef<Record<string, BeforeNext | null>>({});
  const [busy, setBusy] = useState(false);
  const finishing = useRef(false);

  // Track the current step by key: a step disappearing (its plugin was
  // removed) moves on to whatever now sits in its place.
  let index = flow.findIndex((step) => step.id === currentId);
  if (index < 0) {
    index = flow.findIndex((step) => step.position >= lastPosition.current);
    if (index < 0) index = flow.length - 1;
  }
  const step: OnboardingStepDef | undefined = flow[index];

  useEffect(() => {
    if (!step) return;
    lastPosition.current = step.position;
    if (step.id !== currentId) setCurrentId(step.id);
  }, [step, currentId]);

  const finish = useCallback(
    async (skipped: boolean) => {
      if (finishing.current) return;
      finishing.current = true;
      prefs?.markOnboardingSeen(seenFor(flow), {
        completed: true,
        skipped,
      });
      await prefs?.flushNow().catch(() => {});
      onDone();
    },
    [prefs, flow, onDone],
  );

  // Nothing to show (a partial run whose step vanished).
  useEffect(() => {
    if (permissionsLoaded && flow.length === 0) void finish(false);
  }, [permissionsLoaded, flow.length, finish]);

  const canSkip = !flow.some((s) => s.required && !confirmed.has(s.id));
  const isLast = index === flow.length - 1;
  const stepId = step?.id ?? "";
  const stepCanContinue = canContinue[stepId] !== false;

  const goNext = useCallback(async () => {
    if (!step || busy) return;
    const hook = beforeNext.current[step.id];
    if (hook) {
      setBusy(true);
      let ok = false;
      try {
        ok = await hook();
      } catch {
        ok = false;
      } finally {
        setBusy(false);
      }
      if (!ok) return;
    }
    if (step.required) {
      setConfirmed((prev) => new Set(prev).add(step.id));
    }
    if (isLast) {
      void finish(false);
      return;
    }
    setCurrentId(flow[index + 1].id);
  }, [step, busy, isLast, finish, flow, index]);

  const skip = useCallback(() => {
    if (canSkip) void finish(true);
  }, [canSkip, finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || mode === "full") return;
      if (event.defaultPrevented) return;
      skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, skip]);

  const setCanContinue = useCallback(
    (ok: boolean) =>
      setCanContinueMap((prev) =>
        prev[stepId] === ok ? prev : { ...prev, [stepId]: ok },
      ),
    [stepId],
  );
  const setBeforeNext = useCallback(
    (fn: BeforeNext | null) => {
      beforeNext.current[stepId] = fn;
    },
    [stepId],
  );

  const stageValue = useMemo(() => ({ plugins, setPlugins }), [plugins]);

  if (!permissionsLoaded || !step) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const StepComponent = step.Component;
  const Icon = step.icon;

  return (
    <OnboardingStageContext.Provider value={stageValue}>
      <div
        className="fixed inset-0 z-[60] overflow-y-auto bg-background text-foreground"
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.stageLabel")}
      >
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:py-14">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {mode === "partial"
                  ? t("onboarding.partialHeading")
                  : t("onboarding.setupHeading")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t("onboarding.stepCounter", {
                  current: index + 1,
                  total: flow.length,
                })}
              </span>
            </div>
            {onLogout && mode === "full" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={onLogout}
              >
                <LogOut size={12} />
                {t("onboarding.signOut")}
              </Button>
            )}
          </div>

          <div className="flex gap-1">
            {flow.map((s, i) => (
              <div
                key={s.id}
                className={`h-0.5 flex-1 ${
                  i <= index ? "bg-accent-brand" : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>

          <SurfaceScope
            kind="tab"
            className="relative flex flex-col border border-border bg-card"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              {Icon && <Icon size={14} className="text-muted-foreground" />}
              <span className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t(step.titleKey)}
              </span>
            </div>
            <div className="flex flex-col gap-3 px-3 py-4 md:px-4">
              {step.descriptionKey && (
                <p className="text-xs text-muted-foreground">
                  {t(step.descriptionKey)}
                </p>
              )}
              <StepComponent
                key={step.id}
                mode={mode}
                isAdmin={isAdmin}
                isDesktop={isDesktop}
                shellReady={shellReady}
                setCanContinue={setCanContinue}
                setBeforeNext={setBeforeNext}
              />
            </div>
          </SurfaceScope>

          <div className="flex items-center justify-between gap-3">
            <div>
              {canSkip && !isLast && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={skip}
                >
                  {mode === "partial"
                    ? t("onboarding.skipPartial")
                    : t("onboarding.skip")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => setCurrentId(flow[index - 1].id)}
                >
                  <ArrowLeft size={13} />
                  {t("common.back")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-accent-brand/40 text-xs text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                disabled={busy || !stepCanContinue}
                onClick={() => void goNext()}
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {isLast ? t("onboarding.finish") : t("onboarding.next")}
                {!isLast && !busy && <ArrowRight size={13} />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </OnboardingStageContext.Provider>
  );
}
