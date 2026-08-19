import { useTranslation } from "react-i18next";
import { Fingerprint, KeyRound, ShieldCheck, Users } from "lucide-react";

const ITEMS = [
  { icon: KeyRound, key: "credentials" },
  { icon: ShieldCheck, key: "twofa" },
  { icon: Fingerprint, key: "identity" },
  { icon: Users, key: "sharing" },
] as const;

/**
 * Credential reuse and 2FA are the two things worth knowing before someone
 * types a password into a host form, so they get their own step rather than a
 * line buried in the feature list.
 */
export function SecurityStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.securityIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        {ITEMS.map(({ icon: Icon, key }) => (
          <div
            key={key}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {t(`onboarding.security_${key}`)}
              </span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(`onboarding.security_${key}_desc`)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        {t("onboarding.securityEncryptionNote")}
      </p>
    </div>
  );
}
