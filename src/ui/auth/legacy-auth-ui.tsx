/**
 * Login UI that still lives in core for 2.9.0 (OIDC, LDAP) and the
 * certificate SSH auth editors, registered through the same registries a plugin uses.
 * Phase C moves each into its plugin by moving its block out of this file;
 * D1 deletes the file once it is empty.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LoginMethodUIProps } from "@termix/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  registerLoginMethod,
  registerSshAuthEditor,
} from "@/plugin-host/auth-registry";

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
}

/** Test helper. */
export function resetLegacyAuthUIForTests(): void {
  registered = false;
}
