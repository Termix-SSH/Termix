import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/button";
import { pluginKey } from "@/lib/plugin-i18n";
import {
  getUserSecondFactors,
  resetUserSecondFactors,
  type UserSecondFactorSummary,
} from "@/api/auth-methods-api";

/**
 * Every second factor a user enrolled in, including ones whose plugin is off
 * (which is what locks a user out), with a reset for all of them.
 */
export function AdminSecondFactorsSection({
  userId,
  username,
  heading,
  requestConfirm,
  onReset,
}: {
  userId: string;
  username: string;
  heading: ReactNode;
  requestConfirm: (message: string, onConfirm: () => void) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [factors, setFactors] = useState<UserSecondFactorSummary[]>([]);
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    getUserSecondFactors(userId)
      .then(setFactors)
      .catch(() => setFactors([]));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function reset() {
    setWorking(true);
    try {
      await resetUserSecondFactors(userId);
      toast.success(t("admin.secondFactorsResetSuccess"));
      onReset();
      load();
    } catch {
      toast.error(t("admin.secondFactorsResetFailed"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {heading}
      {factors.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("admin.secondFactorsNone")}
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          {factors.map((factor) => (
            <div
              key={`${factor.pluginId}:${factor.factorId}`}
              className="flex items-center justify-between text-xs"
            >
              <span>
                {factor.labelKey
                  ? t(
                      factor.pluginId === "core"
                        ? factor.labelKey
                        : pluginKey(factor.pluginId, factor.labelKey),
                      { defaultValue: factor.factorId },
                    )
                  : factor.factorId}
              </span>
              {!factor.available && (
                <span className="text-[10px] text-destructive">
                  {t("admin.secondFactorUnavailable")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {factors.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-fit text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={working}
          onClick={() =>
            requestConfirm(
              t("admin.resetSecondFactorsConfirm", { username }),
              () => {
                void reset();
              },
            )
          }
        >
          <ShieldOff className="size-3" />
          {t("admin.resetSecondFactors")}
        </Button>
      )}
    </div>
  );
}
