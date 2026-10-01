import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type SecondFactorUIProps,
} from "@termix/plugin-sdk/frontend";
import { isValidTotpInput, normalizeTotpInput } from "./totp-input";

const primaryButton =
  "w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold";

export function TotpChallenge({
  disabled,
  verify,
  cancel,
}: SecondFactorUIProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isValidTotpInput(code)) {
          toast.error(t("challenge.enterCode"));
          return;
        }
        setLoading(true);
        try {
          await verify({ totp_code: code });
        } finally {
          setLoading(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("challenge.verify")}
        </span>
        <Input
          ref={inputRef}
          id="totp-code"
          type="text"
          placeholder="000000"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(normalizeTotpInput(e.target.value))}
          disabled={disabled || loading}
          className="text-center text-2xl tracking-widest font-mono"
          autoComplete="one-time-code"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("challenge.backupCodeHint")}
      </p>
      <Button
        type="submit"
        className={primaryButton}
        disabled={disabled || loading || !isValidTotpInput(code)}
      >
        {loading ? t("common.loading") : t("challenge.verify")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={cancel}
        disabled={loading}
      >
        {t("common.cancel")}
      </Button>
    </form>
  );
}
