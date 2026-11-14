/* eslint-disable react-refresh/only-export-components */
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  challengeStepUp,
  listStepUpFactors,
  verifyStepUp,
} from "@/api/auth-methods-api";
import { useSecondFactors } from "@/plugin-host/auth-registry";
import { PanePrompt } from "@/components/surface/surface-scope";
import { PROMPT_BUTTON } from "@/components/surface/prompt-styles";
import { Segmented } from "@/components/panel-layout";
import { LoadingState } from "@/components/loading-state";

/**
 * The shell asks for a second factor itself, so a plugin (framed or not)
 * only learns whether the person proved it. The factor screens come from the
 * plugins that provide them and run in the page.
 */

type Pending = { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
let promise: Promise<boolean> | null = null;
let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** True once the person proved a factor, false when they gave up. */
export function requestStepUp(): Promise<boolean> {
  if (mounted === 0) return Promise.resolve(false);
  // One prompt at a time; a second ask waits on the same answer.
  if (promise) return promise;
  promise = new Promise<boolean>((resolve) => {
    pending = { resolve };
    emit();
  });
  return promise;
}

function settle(ok: boolean) {
  const current = pending;
  pending = null;
  promise = null;
  emit();
  current?.resolve(ok);
}

function usePending(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending !== null,
    () => false,
  );
}

function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : fallback;
}

function StepUpCard() {
  const { t } = useTranslation();
  const titleId = useId();
  const uis = useSecondFactors();
  const [ids, setIds] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listStepUpFactors()
      .then((factors) => setIds(factors.map((factor) => factor.id)))
      .catch(() => setIds([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      settle(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const factors = useMemo(
    () => uis.filter((ui) => ids?.includes(ui.id)),
    [uis, ids],
  );
  const factor = factors.find((ui) => ui.id === picked) ?? factors[0];

  async function verify(body: Record<string, unknown>) {
    if (!factor) return;
    setBusy(true);
    try {
      await verifyStepUp(factor.id, body);
      settle(true);
    } catch (error) {
      toast.error(errorText(error, t("auth.stepUp.failed")));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (ids === null) {
    body = <LoadingState />;
  } else if (!factor) {
    body = (
      <p className="text-xs text-muted-foreground">
        {t("auth.stepUp.noFactor")}
      </p>
    );
  } else {
    const Challenge = factor.component;
    body = (
      <div className="flex flex-col gap-3">
        {factors.length > 1 && (
          <Segmented
            value={factor.id}
            onChange={setPicked}
            options={factors.map((entry) => ({
              value: entry.id,
              label: t(entry.titleKey),
            }))}
          />
        )}
        <Challenge
          key={factor.id}
          factorId={factor.id}
          rememberMe={false}
          disabled={busy}
          verify={verify}
          challenge={() => challengeStepUp(factor.id)}
          cancel={() => settle(false)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-500">
      <PanePrompt
        open
        title={t("auth.stepUp.title")}
        titleId={titleId}
        description={t("auth.stepUp.description")}
        icon={<ShieldCheck className="size-4" />}
        onCancel={() => settle(false)}
        actions={
          <button
            type="button"
            onClick={() => settle(false)}
            className={PROMPT_BUTTON}
          >
            {t("common.cancel")}
          </button>
        }
      >
        {body}
      </PanePrompt>
    </div>
  );
}

/** Mounted once by the shell; asks nothing until someone calls requestStepUp. */
export function StepUpPromptHost() {
  const open = usePending();
  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
      if (mounted === 0) settle(false);
    };
  }, []);
  return open ? <StepUpCard /> : null;
}
