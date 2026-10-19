import { useTranslation } from "react-i18next";
import { useLoginMethods, useSecondFactors } from "@/plugin-host/auth-registry";

/**
 * Enrolment sections login methods and second factors register, such as
 * adding a passkey or setting up an authenticator app.
 */
export function AuthEnrollmentSections({
  factorsOnly = false,
}: {
  /** Only second factors, for a login policy that requires one. */
  factorsOnly?: boolean;
} = {}) {
  const { t } = useTranslation();
  const methods = useLoginMethods();
  const factors = useSecondFactors();
  const sections = [...(factorsOnly ? [] : methods), ...factors].filter(
    (entry) => entry.enrollment,
  );
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {sections.map((entry) => {
        const Enrollment = entry.enrollment!;
        return (
          <div
            key={`${entry.pluginId}:${entry.id}`}
            className="flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t(entry.titleKey)}
            </span>
            <Enrollment />
          </div>
        );
      })}
    </div>
  );
}
