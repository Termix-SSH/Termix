import { useTranslation } from "react-i18next";

interface VersionBadgeProps {
  status: "up_to_date" | "requires_update" | "beta";
  releaseUrl?: string;
  className?: string;
}

export function VersionBadge({
  status,
  releaseUrl,
  className = "",
}: VersionBadgeProps) {
  const { t } = useTranslation();

  const badgeClassName = `text-[10px] px-1.5 py-0.5 font-semibold leading-none ${
    status === "beta"
      ? "bg-blue-500/20 text-blue-400"
      : status === "requires_update"
        ? "bg-yellow-500/20 text-yellow-400"
        : "bg-accent-brand/20 text-accent-brand"
  }${className ? ` ${className}` : ""}`;

  const label =
    status === "beta"
      ? t("dashboard.beta").toUpperCase()
      : status === "requires_update"
        ? t("dashboard.updateAvailable").toUpperCase()
        : t("dashboardTab.stable");

  // Only the update case leads anywhere. Wherever this badge is rendered it is
  // the one place a pending release is announced, so it also has to be the way
  // to reach it -- otherwise "UPDATE AVAILABLE" is a dead end. The label alone
  // does not say where the link goes, hence the spelled-out accessible name.
  if (status === "requires_update" && releaseUrl) {
    const linkLabel = t("versionCheck.updateLinkLabel");
    return (
      <a
        href={releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={linkLabel}
        aria-label={linkLabel}
        className={`${badgeClassName} cursor-pointer hover:underline`}
      >
        {label}
      </a>
    );
  }

  return <span className={badgeClassName}>{label}</span>;
}
