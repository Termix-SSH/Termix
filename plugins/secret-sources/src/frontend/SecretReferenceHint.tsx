import { useTranslation } from "@termix/plugin-sdk/frontend";

/** One line under a secret field: references are allowed, here is where to set them up. */
export function SecretReferenceHint({ onManage }: { onManage: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="text-[10px] text-muted-foreground">
      {t("hint")}{" "}
      <button
        type="button"
        className="text-accent-brand hover:underline"
        onClick={onManage}
      >
        {t("manage")}
      </button>
    </p>
  );
}
