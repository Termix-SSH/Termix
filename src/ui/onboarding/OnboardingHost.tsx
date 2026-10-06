import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { usePermissions } from "@/hooks/use-permissions";
import { isElectron } from "@/lib/electron";
import { isEmbeddedAuthFrame } from "@/lib/embedded-frame";
import { settledPromise } from "@/plugin-host/plugin-store";
import { subscribeToActionRegistry } from "@/shell/action-registry";
import { onboardingSteps, type OnboardingMode } from "./onboarding-registry";
import {
  baselineSeen,
  computeFlow,
  needsFullFlow,
  ONBOARDING_ADMIN_PERMISSION,
} from "./onboarding-flow";
import { canEnrollSecondFactor, currentStepDefs } from "./use-onboarding-steps";

const OnboardingStage = lazy(() =>
  import("./OnboardingStage").then((m) => ({ default: m.OnboardingStage })),
);

/** Fired by "Run setup again" in settings. */
export const OPEN_ONBOARDING_EVENT = "termix:open-onboarding";

const RECHECK_DELAY_MS = 750;

/**
 * Onboarding once the app is up: the rerun from settings, and a partial run
 * whenever steps appear that the user has not seen (a plugin installed here
 * or elsewhere, a step whose version went up). Both draw full screen over
 * the shell without unmounting it.
 */
export function OnboardingHost({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const prefs = useUiPreferencesContext();
  const { has, loaded } = usePermissions();
  const [mode, setMode] = useState<OnboardingMode | null>(null);
  const [settled, setSettled] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const embedded = isEmbeddedAuthFrame();

  useEffect(() => {
    onOpenChange?.(mode !== null);
  }, [mode, onOpenChange]);

  useEffect(() => {
    let cancelled = false;
    void settledPromise().then(() => !cancelled && setSettled(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (embedded) return;
    const open = () => {
      void settledPromise().then(() => setMode("rerun"));
    };
    window.addEventListener(OPEN_ONBOARDING_EVENT, open);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, open);
  }, [embedded]);

  const onboarding = prefs?.preferences.onboarding;
  const ready = !embedded && settled && loaded && !!prefs?.loaded;

  // Carried over from the old onboarding: plugin steps that already exist
  // count as seen, without showing any of them.
  useEffect(() => {
    if (!ready || !onboarding?.baselinePending) return;
    prefs?.markOnboardingSeen(baselineSeen(currentStepDefs(has)), {
      baselineDone: true,
    });
  }, [ready, onboarding?.baselinePending, prefs, has]);

  useEffect(() => {
    if (!ready || !onboarding || onboarding.baselinePending) return;
    if (needsFullFlow(onboarding)) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (modeRef.current !== null) return;
      if (document.visibilityState === "hidden") return;
      const isAdmin = has(ONBOARDING_ADMIN_PERMISSION);
      const pending = computeFlow(currentStepDefs(has), onboarding.seen, {
        mode: "partial",
        isAdmin,
        isDesktop: isElectron(),
        has,
        pluginSetupPending: false,
        pluginsManagedElsewhere: false,
        canEnrollSecondFactor: canEnrollSecondFactor(),
      });
      if (pending.length > 0) setMode("partial");
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, RECHECK_DELAY_MS);
    };
    schedule();
    const offSteps = onboardingSteps.subscribe(schedule);
    const offSlots = subscribeToActionRegistry(schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      offSteps();
      offSlots();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [ready, onboarding, has]);

  if (!mode || embedded) return null;

  return (
    <Suspense fallback={null}>
      <OnboardingStage
        key={mode}
        mode={mode}
        shellReady
        onDone={() => setMode(null)}
      />
    </Suspense>
  );
}
