import { useTranslation } from "react-i18next";
import { AuthEnrollmentSections } from "@/sidebar/AuthEnrollmentSections";

/** A passkey or authenticator, set up right here when a plugin offers one. */
export function SecurityStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.securityIntro")}
      </p>
      <AuthEnrollmentSections />
    </div>
  );
}
