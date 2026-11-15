/**
 * Login methods and second factors the shell draws from what a plugin's
 * backend describes: buttons, fields and WebAuthn prompts. No plugin code
 * runs on the login screen.
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Fingerprint, KeyRound } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { pluginKey } from "@/lib/plugin-i18n";
import {
  getWebAuthnLoginOptions,
  type LoginField,
  type PublicLoginMethod,
  type SecondFactorRef,
} from "@/api/auth-methods-api";
import {
  promptClosed,
  readWebAuthnStart,
  runWebAuthn,
  webAuthnSupported,
} from "./webauthn-browser";

const labelClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

function errorText(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  if (typeof data?.error === "string" && data.error) return data.error;
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : fallback;
}

/** A plugin's own string, falling back to core's. */
function usePluginText(pluginId: string) {
  const { t } = useTranslation([pluginId, "translation"]);
  return (key: string, options?: Record<string, unknown>) =>
    t(pluginKey(pluginId, key), {
      ...options,
      defaultValue: t(key, options),
    });
}

function FieldInputs({
  pluginId,
  fields,
  values,
  onChange,
  disabled,
}: {
  pluginId: string;
  fields: LoginField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  disabled: boolean;
}) {
  const text = usePluginText(pluginId);
  return (
    <>
      {fields.map((field, index) => (
        <label key={field.name} className="flex flex-col gap-1.5">
          <span className={labelClass}>{text(field.labelKey)}</span>
          <Input
            type={field.type === "password" ? "password" : "text"}
            autoComplete={
              field.autocomplete ??
              (field.type === "code" ? "one-time-code" : undefined)
            }
            value={values[field.name] ?? ""}
            onChange={(e) => onChange(field.name, e.target.value)}
            disabled={disabled}
            autoFocus={index === 0}
          />
        </label>
      ))}
    </>
  );
}

function FieldForm({
  pluginId,
  fields,
  disabled,
  submitLabel,
  onSubmit,
}: {
  pluginId: string;
  fields: LoginField[];
  disabled: boolean;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (fields.some((field) => !(values[field.name] ?? "").trim())) {
      toast.error(t("errors.requiredField"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FieldInputs
        pluginId={pluginId}
        fields={fields}
        values={values}
        onChange={(name, value) =>
          setValues((current) => ({ ...current, [name]: value }))
        }
        disabled={disabled || busy}
      />
      <Button
        type="submit"
        disabled={disabled || busy}
        className="w-full h-10 font-bold"
      >
        {submitLabel}
      </Button>
    </form>
  );
}

function FormMethod({
  method,
  instances,
  disabled,
  submit,
}: {
  method: PublicLoginMethod;
  instances: PublicLoginMethod["instances"];
  disabled: boolean;
  submit: (body: Record<string, unknown>, instanceId?: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const text = usePluginText(method.pluginId);
  const [open, setOpen] = useState<string | null>(null);
  const fields = method.fields ?? [];
  if (fields.length === 0) return null;
  if (instances.length === 0) {
    return (
      <FieldForm
        pluginId={method.pluginId}
        fields={fields}
        disabled={disabled}
        submitLabel={text(method.labelKey)}
        onSubmit={(values) => submit(values)}
      />
    );
  }
  return (
    <>
      {instances.map((instance) => {
        const expanded = open === instance.id;
        return (
          <div key={instance.id} className="flex flex-col border border-border">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : instance.id)}
              className="flex items-center justify-between w-full px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <span>
                {t("auth.loginWithProvider", { name: instance.label })}
              </span>
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            {expanded && (
              <div className="p-3 border-t border-border">
                <FieldForm
                  pluginId={method.pluginId}
                  fields={fields}
                  disabled={disabled}
                  submitLabel={t("auth.pluginLogin.signIn")}
                  onSubmit={(values) => submit(values, instance.id)}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function WebAuthnMethod({
  method,
  instanceId,
  disabled,
  username,
  submit,
}: {
  method: PublicLoginMethod;
  instanceId?: string;
  disabled: boolean;
  username?: string;
  submit: (body: Record<string, unknown>, instanceId?: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const text = usePluginText(method.pluginId);
  const [busy, setBusy] = useState(false);
  if (!webAuthnSupported()) return null;
  async function run() {
    setBusy(true);
    try {
      const start = await getWebAuthnLoginOptions(
        method.id,
        instanceId,
        username?.trim() || undefined,
      );
      const response = await runWebAuthn("get", start.publicKey);
      await submit({ ...(start.context ?? {}), response }, instanceId);
    } catch (error) {
      if (!promptClosed(error)) {
        toast.error(errorText(error, t("auth.pluginLogin.keyFailed")));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void run()}
      disabled={disabled || busy}
      className="w-full h-10 font-bold"
    >
      <span className="flex items-center gap-2">
        <Fingerprint className="size-4" />
        {text(method.labelKey)}
      </span>
    </Button>
  );
}

/** One login method the server described, drawn by the shell. */
export function PluginLoginMethodView({
  method,
  view,
  disabled,
  username,
  submit,
  startRedirect,
}: {
  method: PublicLoginMethod;
  view: "password" | "external";
  disabled: boolean;
  username?: string;
  submit: (body: Record<string, unknown>, instanceId?: string) => Promise<void>;
  startRedirect: (instanceId?: string) => void;
}) {
  const { t } = useTranslation();
  const instances = method.instances.filter(
    (instance) => !instance.views || instance.views.includes(view),
  );
  // A method that lists instances shows nothing once none fit this page.
  if (method.instances.length > 0 && instances.length === 0) return null;

  if (method.kind === "redirect") {
    return (
      <>
        {instances.map((instance) => (
          <Button
            key={`${method.id}:${instance.id}`}
            onClick={() => startRedirect(instance.id)}
            disabled={disabled}
            className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold"
          >
            {t("auth.loginWithProvider", { name: instance.label })}
          </Button>
        ))}
      </>
    );
  }
  if (method.kind === "webauthn") {
    return (
      <WebAuthnMethod
        method={method}
        instanceId={instances[0]?.id}
        disabled={disabled}
        username={username}
        submit={submit}
      />
    );
  }
  return (
    <FormMethod
      method={method}
      instances={instances}
      disabled={disabled}
      submit={submit}
    />
  );
}

/** Whether the shell can draw this second factor by itself. */
export function canDrawSecondFactor(factor: SecondFactorRef): boolean {
  if (!factor.prompt) return false;
  return factor.prompt.kind !== "webauthn" || webAuthnSupported();
}

/** The second factor step, drawn from the factor's prompt. */
export function PluginSecondFactorView({
  factor,
  disabled,
  verify,
  challenge,
  cancel,
}: {
  factor: SecondFactorRef;
  disabled: boolean;
  verify: (body: Record<string, unknown>) => Promise<void>;
  challenge: () => Promise<unknown>;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const prompt = factor.prompt;
  if (!prompt) return null;

  const cancelButton = (
    <Button
      type="button"
      variant="outline"
      onClick={cancel}
      disabled={busy}
      className="w-full"
    >
      {t("common.cancel")}
    </Button>
  );

  if (prompt.kind === "webauthn") {
    const run = async () => {
      setBusy(true);
      try {
        const start = readWebAuthnStart(await challenge());
        if (!start) throw new Error(t("auth.pluginLogin.keyFailed"));
        const response = await runWebAuthn("get", start.publicKey);
        await verify({ ...start.context, response });
      } catch (error) {
        if (!promptClosed(error)) {
          toast.error(errorText(error, t("auth.pluginLogin.keyFailed")));
        }
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("auth.pluginLogin.keyPrompt")}
        </p>
        <Button
          type="button"
          onClick={() => void run()}
          disabled={disabled || busy}
          className="w-full h-10 font-bold"
        >
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t("auth.pluginLogin.useKey")}
          </span>
        </Button>
        {cancelButton}
      </div>
    );
  }

  const fields: LoginField[] =
    prompt.kind === "fields"
      ? prompt.fields
      : [
          {
            name: prompt.field ?? "code",
            type: "code",
            labelKey: prompt.labelKey ?? "auth.pluginLogin.code",
          },
        ];
  return (
    <div className="flex flex-col gap-3">
      <FieldForm
        pluginId={factor.pluginId}
        fields={fields}
        disabled={disabled}
        submitLabel={t("auth.pluginLogin.verify")}
        onSubmit={(values) => verify(values)}
      />
      {cancelButton}
    </div>
  );
}
