import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button, Input } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type LoginMethodUIProps,
} from "@termix/plugin-sdk/frontend";

const labelClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

/** A collapsible username and password form per enabled directory. */
export function LdapLoginForms({
  instances,
  disabled,
  submit,
}: LoginMethodUIProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUsername("");
    setPassword("");
  }, [expandedId]);

  return (
    <>
      {instances.map((instance) => {
        const expanded = expandedId === instance.id;
        return (
          <div key={instance.id} className="flex flex-col border border-border">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : instance.id)}
              className="flex items-center justify-between w-full px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <span>{t("loginWithProvider", { name: instance.label })}</span>
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {expanded && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!username.trim() || !password) {
                    toast.error(t("requiredField"));
                    return;
                  }
                  setLoading(true);
                  try {
                    await submit(
                      { username: username.trim(), password },
                      instance.id,
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex flex-col gap-3 p-3 border-t border-border"
              >
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>{t("username")}</span>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={disabled || loading}
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>{t("password")}</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={disabled || loading}
                    className="font-mono"
                  />
                </label>
                <Button
                  type="submit"
                  className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
                  disabled={disabled || loading}
                >
                  {loading ? t("loading") : t("signIn")}
                </Button>
              </form>
            )}
          </div>
        );
      })}
    </>
  );
}
