import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Switch } from "@/components/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { ElectronLoginForm } from "@/auth/ElectronLoginForm";
import {
  completeLink,
  getLinkPreview,
  probeServer,
  reloginLink,
  type ProbeProblem,
  type ServerTarget,
  type SyncStatus,
} from "@/api/sync-api";
import { ProxySettingsFields } from "./ProxySettingsFields";

type Step = "server" | "signin" | "choose" | "finishing";

interface LinkServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (status: SyncStatus) => void;
  /** Sign back in to the server this desktop is already linked to. */
  relogin?: { serverUrl: string };
}

function problemText(
  t: (key: string, options?: Record<string, unknown>) => string,
  problem: ProbeProblem | undefined,
  message: string | undefined,
): string {
  switch (problem) {
    case "invalid_url":
      return t("sync.problems.invalidUrl");
    case "tls_untrusted":
      return t("sync.problems.tlsUntrusted");
    case "basic_auth_required":
      return t("sync.problems.basicAuthRequired");
    case "proxy_login":
      return t("sync.problems.proxyLogin");
    case "not_termix":
      return t("sync.problems.notTermix");
    case "version_mismatch":
      return t("sync.problems.versionMismatch");
    case "different_account":
      return t("sync.problems.differentAccount");
    default:
      return message
        ? t("sync.problems.unreachableWithReason", { reason: message })
        : t("sync.problems.unreachable");
  }
}

export function LinkServerDialog({
  open,
  onOpenChange,
  onLinked,
  relogin,
}: LinkServerDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(relogin ? "signin" : "server");
  const [target, setTarget] = useState<ServerTarget>({
    serverUrl: relogin?.serverUrl ?? "",
    customHeaders: [],
    basicAuth: null,
    allowInvalidCertificate: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [problemKind, setProblemKind] = useState<ProbeProblem | null>(null);
  const [serverName, setServerName] = useState<string | undefined>();
  const [token, setToken] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [finishError, setFinishError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(relogin ? "signin" : "server");
    setProblem(null);
    setProblemKind(null);
    setToken(null);
    setFinishError(null);
    setMode("merge");
    if (relogin) {
      setTarget((current) => ({ ...current, serverUrl: relogin.serverUrl }));
      return;
    }
    // An older version of the app may have saved a server address.
    window.electronAPI
      ?.invoke?.("get-previous-server-url")
      .then((result) => {
        const url = (result as { serverUrl?: string | null } | null)?.serverUrl;
        if (url) {
          setTarget((current) =>
            current.serverUrl ? current : { ...current, serverUrl: url },
          );
        }
      })
      .catch(() => {});
  }, [open, relogin]);

  const handleCheck = async () => {
    setChecking(true);
    setProblem(null);
    setProblemKind(null);
    try {
      const result = await probeServer(target);
      if (!result.ok) {
        setProblemKind(result.problem ?? null);
        setProblem(problemText(t, result.problem, result.message));
        if (
          result.problem === "basic_auth_required" ||
          result.problem === "proxy_login"
        ) {
          setShowAdvanced(true);
        }
        if (result.problem === "basic_auth_required" && !target.basicAuth) {
          setTarget((current) => ({
            ...current,
            basicAuth: { username: "", password: "" },
          }));
        }
        return;
      }
      setTarget((current) => ({
        ...current,
        serverUrl: result.serverUrl ?? current.serverUrl,
      }));
      setServerName(result.name);
      setStep("signin");
    } catch {
      setProblem(problemText(t, "unreachable", undefined));
    } finally {
      setChecking(false);
    }
  };

  const finish = async (sessionToken: string, chosen: "merge" | "replace") => {
    setStep("finishing");
    setFinishError(null);
    try {
      const status = await completeLink({
        ...target,
        token: sessionToken,
        mode: chosen,
        serverName,
      });
      toast.success(t("sync.wizard.linked"));
      onLinked(status);
      onOpenChange(false);
    } catch (error) {
      const data = (
        error as {
          response?: { data?: { problem?: ProbeProblem; message?: string } };
        }
      )?.response?.data;
      setFinishError(problemText(t, data?.problem, data?.message));
      setStep("choose");
    }
  };

  const handleSignedIn = async (sessionToken: string | null) => {
    if (!sessionToken) return;
    if (relogin) {
      try {
        const status = await reloginLink(sessionToken);
        toast.success(t("sync.wizard.signedInAgain"));
        onLinked(status);
        onOpenChange(false);
      } catch (error) {
        const data = (
          error as {
            response?: {
              data?: {
                error?: string;
                problem?: ProbeProblem;
                message?: string;
              };
            };
          }
        )?.response?.data;
        throw new Error(
          data?.error === "different_account"
            ? t("sync.problems.differentAccount")
            : problemText(t, data?.problem, data?.message),
        );
      }
      return;
    }
    setToken(sessionToken);
    const preview = await getLinkPreview().catch(() => ({}));
    setCounts(preview);
    const total = Object.values(preview).reduce((sum, count) => sum + count, 0);
    if (total === 0) {
      await finish(sessionToken, "merge");
      return;
    }
    setStep("choose");
  };

  const localTotal = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const wide = step === "signin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`bg-card border border-border rounded-none ${
          wide ? "sm:max-w-4xl h-[80vh] flex flex-col p-0 gap-0" : "sm:max-w-lg"
        }`}
        // The sign-in step is a page from another origin in an iframe; clicks
        // inside it look like outside clicks to the dialog.
        onPointerDownOutside={(event) => wide && event.preventDefault()}
        onInteractOutside={(event) => wide && event.preventDefault()}
      >
        <DialogHeader className={wide ? "sr-only" : undefined}>
          <DialogTitle>
            {relogin ? t("sync.wizard.reloginTitle") : t("sync.wizard.title")}
          </DialogTitle>
          <DialogDescription>
            {step === "server" && t("sync.wizard.serverDescription")}
            {step === "signin" &&
              t("sync.wizard.signinDescription", { url: target.serverUrl })}
            {step === "choose" && t("sync.wizard.chooseDescription")}
            {step === "finishing" && t("sync.wizard.finishingDescription")}
          </DialogDescription>
        </DialogHeader>

        {step === "server" && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCheck();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label
                className="text-xs font-semibold"
                htmlFor="sync-server-url"
              >
                {t("sync.wizard.serverUrl")}
              </label>
              <Input
                id="sync-server-url"
                autoFocus
                className="rounded-none"
                placeholder="https://termix.example.com"
                value={target.serverUrl}
                onChange={(event) =>
                  setTarget({ ...target, serverUrl: event.target.value })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                {t("sync.wizard.serverUrlHint")}
              </p>
            </div>

            {problem && (
              <div className="flex gap-2 border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
                <AlertCircle className="size-4 shrink-0 text-destructive" />
                <span>{problem}</span>
              </div>
            )}

            {(problemKind === "tls_untrusted" ||
              target.allowInvalidCertificate) && (
              <div className="flex items-center justify-between gap-3 border border-border p-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">
                    {t("sync.proxy.allowInvalidCertificate")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("sync.proxy.allowInvalidCertificateHint")}
                  </span>
                </div>
                <Switch
                  checked={!!target.allowInvalidCertificate}
                  onCheckedChange={(checked) =>
                    setTarget({ ...target, allowInvalidCertificate: checked })
                  }
                />
              </div>
            )}

            <button
              type="button"
              className="self-start text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced
                ? t("sync.wizard.hideProxySettings")
                : t("sync.wizard.showProxySettings")}
            </button>
            {showAdvanced && (
              <ProxySettingsFields
                customHeaders={target.customHeaders ?? []}
                basicAuth={target.basicAuth ?? null}
                onChange={(next) => setTarget({ ...target, ...next })}
              />
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                className="rounded-none"
                disabled={checking || !target.serverUrl.trim()}
              >
                {checking && <Loader2 className="size-4 animate-spin" />}
                {t("sync.wizard.continue")}
              </Button>
            </div>
          </form>
        )}

        {step === "signin" && (
          <div className="flex-1 min-h-0">
            <ElectronLoginForm
              serverUrl={target.serverUrl}
              targetPurpose="link"
              onAuthSuccess={handleSignedIn}
              onChangeServer={() =>
                relogin ? onOpenChange(false) : setStep("server")
              }
            />
          </div>
        )}

        {step === "choose" && (
          <div className="flex flex-col gap-3">
            {finishError && (
              <div className="flex gap-2 border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
                <AlertCircle className="size-4 shrink-0 text-destructive" />
                <span>{finishError}</span>
              </div>
            )}
            {(
              [
                {
                  value: "merge",
                  title: t("sync.wizard.mergeTitle"),
                  body: t("sync.wizard.mergeBody", { count: localTotal }),
                },
                {
                  value: "replace",
                  title: t("sync.wizard.replaceTitle"),
                  body: t("sync.wizard.replaceBody", { count: localTotal }),
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`text-left border p-3 flex flex-col gap-1 transition-colors ${
                  mode === option.value
                    ? "border-accent-brand bg-accent-brand/10"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <span className="text-sm font-semibold">{option.title}</span>
                <span className="text-xs text-muted-foreground">
                  {option.body}
                </span>
              </button>
            ))}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                className="rounded-none"
                disabled={!token}
                onClick={() => token && void finish(token, mode)}
              >
                {t("sync.wizard.link")}
              </Button>
            </div>
          </div>
        )}

        {step === "finishing" && (
          <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-accent-brand" />
            {t("sync.wizard.linking")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
