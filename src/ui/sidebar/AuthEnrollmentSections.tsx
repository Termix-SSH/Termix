import { useTranslation } from "react-i18next";
import {
  ENROLLMENT_SLOT,
  useLoginMethods,
  useSecondFactors,
} from "@/plugin-host/auth-registry";
import { getForeignRuntime } from "@/components/foreign/foreign-runtime";
import { ForeignSlot } from "@/components/foreign/ForeignSlot";

const titleClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

/**
 * Inside a plugin frame the screens belong to other plugins, so the shell
 * draws them over this frame. The plugin needs "auth.enrollment" in its
 * manifest's contributes.uses.
 */
function FramedEnrollmentSections({ factorsOnly }: { factorsOnly: boolean }) {
  const { t } = useTranslation();
  const runtime = getForeignRuntime()!;
  const sections = runtime
    .useSlot(ENROLLMENT_SLOT)
    .filter(
      (entry) => !factorsOnly || entry.actionId.includes(".enrollment.factor."),
    );
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col divide-y divide-border">
      {sections.map((entry) => (
        <div
          key={entry.actionId}
          className="flex flex-col gap-2 py-3 first:pt-0"
        >
          <span className={titleClass}>{t(entry.titleKey)}</span>
          <ForeignSlot of={entry.component} />
        </div>
      ))}
    </div>
  );
}

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
  if (getForeignRuntime()) {
    return <FramedEnrollmentSections factorsOnly={factorsOnly} />;
  }
  return <PageEnrollmentSections factorsOnly={factorsOnly} />;
}

function PageEnrollmentSections({ factorsOnly }: { factorsOnly: boolean }) {
  const { t } = useTranslation();
  const methods = useLoginMethods();
  const factors = useSecondFactors();
  const sections = [...(factorsOnly ? [] : methods), ...factors].filter(
    (entry) => entry.enrollment,
  );
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col divide-y divide-border">
      {sections.map((entry) => {
        const Enrollment = entry.enrollment!;
        return (
          <div
            key={`${entry.pluginId}:${entry.id}`}
            className="flex flex-col gap-2 py-3 first:pt-0"
          >
            <span className={titleClass}>{t(entry.titleKey)}</span>
            <Enrollment />
          </div>
        );
      })}
    </div>
  );
}
