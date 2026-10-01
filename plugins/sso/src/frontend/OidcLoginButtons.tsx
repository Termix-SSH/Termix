import { useState } from "react";
import { Button } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type LoginMethodUIProps,
} from "@termix/plugin-sdk/frontend";

/** One button per enabled provider. */
export function OidcLoginButtons({
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
          className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
        >
          {loadingId === instance.id
            ? t("loading")
            : t("loginWithProvider", { name: instance.label })}
        </Button>
      ))}
    </>
  );
}
