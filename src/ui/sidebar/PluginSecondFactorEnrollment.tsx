import { useTranslation } from "react-i18next";
import { useSecondFactors } from "@/plugin-host/auth-registry";

/**
 * Enrolment sections second-factor plugins register. Core's own TOTP and
 * passkey sections sit above this until they move into plugins.
 */
export function PluginSecondFactorEnrollment() {
  const { t } = useTranslation();
  const factors = useSecondFactors().filter(
    (factor) => factor.enrollment && factor.pluginId !== "core",
  );
  if (factors.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {factors.map((factor) => {
        const Enrollment = factor.enrollment!;
        return (
          <div key={factor.id} className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t(factor.titleKey)}
            </span>
            <Enrollment />
          </div>
        );
      })}
    </div>
  );
}
