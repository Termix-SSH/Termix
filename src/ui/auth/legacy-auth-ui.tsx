/**
 * The certificate SSH auth editors that still live in core for 2.9.0,
 * registered through the same registry a plugin uses.
 * Phase C moves each into its plugin by moving its block out of this file;
 * D1 deletes the file once it is empty.
 */
import { useTranslation } from "react-i18next";
import { registerSshAuthEditor } from "@/plugin-host/auth-registry";

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
