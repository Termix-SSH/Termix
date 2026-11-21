import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openDiagnostics } from "./open-diagnostics";

/**
 * A small "make a report" link. With `afterMs` it shows only once loading
 * has taken that long.
 */
export function ReportLink({
  label,
  afterMs,
  className,
}: {
  label: string;
  afterMs?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(!afterMs);

  useEffect(() => {
    if (!afterMs) return;
    const timer = setTimeout(() => setShown(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);

  if (!shown) return null;
  return (
    <button
      type="button"
      onClick={() => openDiagnostics()}
      className={
        className ??
        "text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      }
      title={t("diagnostics.makeReport")}
    >
      {label}
    </button>
  );
}
