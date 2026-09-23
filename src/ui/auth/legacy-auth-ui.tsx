/**
 * Login and second-factor UI that still lives in core for 2.9.0 (OIDC, LDAP,
 * passkeys, TOTP), registered through the same registries a plugin uses.
 * Phase C moves each into its plugin by moving its block out of this file;
 * D1 deletes the file once it is empty.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Fingerprint } from "lucide-react";
import type {
  LoginMethodUIProps,
  SecondFactorUIProps,
} from "@termix/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  registerLoginMethod,
  registerSecondFactor,
  registerSshAuthEditor,
} from "@/plugin-host/auth-registry";
import { isPasskeySupported, loginWithPasskey } from "@/api/webauthn-api";

const primaryButton =
  "w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold";

function OidcLoginButtons({
  instances,
  disabled,
  startRedirect,
}: LoginMethodUIProps) {
  const { t } = useTranslation();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  return (
    <>
      {instances.map((instance) => (
        <Button
          key={instance.id}
          onClick={async () => {
            setLoadingId(instance.id);
            try {
              await startRedirect(instance.id);
            } finally {
              setLoadingId(null);
            }
          }}
          disabled={disabled || loadingId !== null}
          className={primaryButton}
        >
          {loadingId === instance.id
            ? t("common.loading")
            : t("auth.loginWithProvider", { name: instance.label })}
        </Button>
      ))}
    </>
  );
}

function LdapLoginForms({ instances, disabled, submit }: LoginMethodUIProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUsername("");
    setPassword("");
  }, [expandedId]);

  return (
    <>
      {instances.map((instance) => {
        const expanded = expandedId === instance.id;
        return (
          <div key={instance.id} className="flex flex-col border border-border">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : instance.id)}
              className="flex items-center justify-between w-full px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <span>
                {t("auth.loginWithProvider", { name: instance.label })}
              </span>
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {expanded && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!username.trim() || !password) {
                    toast.error(t("errors.requiredField"));
                    return;
                  }
                  setLoading(true);
                  try {
                    await submit(
                      { username: username.trim(), password },
                      instance.id,
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex flex-col gap-3 p-3 border-t border-border"
              >
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("auth.ldapUsername")}
                  </span>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={disabled || loading}
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("auth.ldapPassword")}
                  </span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={disabled || loading}
                    className="font-mono"
                  />
                </label>
                <Button
                  type="submit"
                  className={primaryButton}
                  disabled={disabled || loading}
                >
                  {loading ? t("common.loading") : t("auth.ldapSignIn")}
                </Button>
              </form>
            )}
          </div>
        );
      })}
    </>
  );
}

function PasskeyLoginButton({
  rememberMe,
  disabled,
  complete,
  username,
}: LoginMethodUIProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [supported] = useState(() => {
    try {
      return isPasskeySupported();
    } catch {
      return false;
    }
  });
  if (!supported) return null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        setLoading(true);
        try {
          const result = await loginWithPasskey(
            username?.trim() || undefined,
            rememberMe,
          );
          await complete(result as unknown as Record<string, unknown>);
        } catch (err: unknown) {
          const error = err as {
            name?: string;
            message?: string;
            response?: { data?: { error?: string } };
          };
          // Closing the browser prompt is not a failure worth a toast.
          if (error?.name === "NotAllowedError" || error?.name === "AbortError")
            return;
          toast.error(
            error?.response?.data?.error ||
              error?.message ||
              t("auth.passkeyLoginFailed"),
          );
        } finally {
          setLoading(false);
        }
      }}
      disabled={disabled || loading}
      className="w-full h-10 font-bold"
    >
      <span className="flex items-center gap-2">
        <Fingerprint className="size-4" />
        {t("auth.signInWithPasskey")}
      </span>
    </Button>
  );
}

/** Six-digit codes, or a backup code of up to eight letters and digits. */
export function normalizeTotpInput(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

export function isValidTotpInput(value: string): boolean {
  return /^[A-Z0-9]{6,8}$/.test(value);
}

function TotpChallenge({ disabled, verify, cancel }: SecondFactorUIProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isValidTotpInput(code)) {
          toast.error(t("auth.enterCode"));
          return;
        }
        setLoading(true);
        try {
          await verify({ totp_code: code });
        } finally {
          setLoading(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("auth.verifyCode")}
        </span>
        <Input
          ref={inputRef}
          id="totp-code"
          type="text"
          placeholder="000000"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(normalizeTotpInput(e.target.value))}
          disabled={disabled || loading}
          className="text-center text-2xl tracking-widest font-mono"
          autoComplete="one-time-code"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("auth.backupCodeHint")}
      </p>
      <Button
        type="submit"
        className={primaryButton}
        disabled={disabled || loading || !isValidTotpInput(code)}
      >
        {loading ? t("common.loading") : t("auth.verifyCode")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={cancel}
        disabled={loading}
      >
        {t("common.cancel")}
      </Button>
    </form>
  );
}

function CertificateAuthInfo({
  labelKey,
  descriptionKey,
  docsUrl,
}: {
  labelKey: string;
  descriptionKey: string;
  docsUrl: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t(labelKey)}
        </span>
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.docsLink")}
        </a>
      </div>
      <p className="text-[10px] text-muted-foreground">{t(descriptionKey)}</p>
    </div>
  );
}

function OpksshAuthEditor() {
  return (
    <CertificateAuthInfo
      labelKey="hosts.opksshLabel"
      descriptionKey="hosts.opksshDesc"
      docsUrl="https://docs.termix.site/features/authentication/opkssh"
    />
  );
}

function StepCaAuthEditor() {
  return (
    <CertificateAuthInfo
      labelKey="hosts.stepcaLabel"
      descriptionKey="hosts.stepcaDesc"
      docsUrl="https://smallstep.com/docs/step-ca/provisioners/#oauthoidc-single-sign-on"
    />
  );
}

let registered = false;

export function ensureLegacyAuthUI(): void {
  if (registered) return;
  registered = true;
  registerLoginMethod({
    id: "oidc",
    pluginId: "core",
    titleKey: "auth.loginWithSso",
    component: OidcLoginButtons,
  });
  registerLoginMethod({
    id: "ldap",
    pluginId: "core",
    titleKey: "auth.loginWithLdap",
    component: LdapLoginForms,
  });
  registerLoginMethod({
    id: "passkey",
    pluginId: "core",
    titleKey: "auth.signInWithPasskey",
    component: PasskeyLoginButton,
  });
  registerSshAuthEditor({
    id: "opkssh",
    pluginId: "core",
    titleKey: "hosts.filterAuthOpkssh",
    component: OpksshAuthEditor,
  });
  registerSshAuthEditor({
    id: "stepca",
    pluginId: "core",
    titleKey: "hosts.filterAuthStepca",
    component: StepCaAuthEditor,
  });
  registerSecondFactor({
    id: "totp",
    pluginId: "core",
    titleKey: "auth.twoFactorAuth",
    component: TotpChallenge,
  });
}

/** Test helper. */
export function resetLegacyAuthUIForTests(): void {
  registered = false;
}
