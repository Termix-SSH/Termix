import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FakeSwitch,
  Input,
  PasswordInput,
  Select2,
  SettingRow,
  Textarea,
  copyToClipboard,
} from "@termix/plugin-sdk/ui";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import {
  createSsoApi,
  type SsoProvider,
  type SsoProviderInput,
  type SsoProviderType,
} from "./sso-api";

const TYPE_LABELS: Record<SsoProviderType, string> = {
  oidc: "OIDC",
  github: "GitHub",
  google: "Google",
};

const AUTHORIZATION_URLS: Record<"github" | "google", string> = {
  github: "https://github.com/login/oauth/authorize",
  google: "https://accounts.google.com/o/oauth2/v2/auth",
};

type Fields = {
  client_id: string;
  client_secret: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  identifier_path: string;
  name_path: string;
  scopes: string;
  allowed_users: string;
  admin_group: string;
  group_claim: string;
  ca_cert: string;
};

const EMPTY_FIELDS: Fields = {
  client_id: "",
  client_secret: "",
  issuer_url: "",
  authorization_url: "",
  token_url: "",
  userinfo_url: "",
  identifier_path: "sub",
  name_path: "name",
  scopes: "openid email profile",
  allowed_users: "",
  admin_group: "",
  group_claim: "",
  ca_cert: "",
};

function errorMessage(error: unknown, fallback: string): string {
  const err = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return err.response?.data?.error || err.message || fallback;
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-xs font-semibold">
        {label}
        {required && <span className="text-accent-brand ml-1">*</span>}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] text-muted-foreground leading-snug">{hint}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {title}
      </span>
      {children}
    </div>
  );
}

function RedirectUri({ uri }: { uri: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 min-w-0 border border-border bg-muted/30">
      <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-muted-foreground px-2 py-1.5">
        {uri}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground"
        title={t("providers.copy")}
        onClick={async () => {
          await copyToClipboard(uri);
          toast.success(t("providers.copied"));
        }}
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}

function ProviderDialog({
  open,
  onOpenChange,
  provider,
  newRedirectUri,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: SsoProvider | null;
  newRedirectUri: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = createSsoApi(usePluginApi());
  const isEdit = provider !== null;
  const [name, setName] = useState("");
  const [type, setType] = useState<SsoProviderType>("oidc");
  const [enabled, setEnabled] = useState(true);
  const [legacyCallback, setLegacyCallback] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(provider?.name ?? "");
    setType(provider?.type ?? "oidc");
    setEnabled(provider?.enabled ?? true);
    setLegacyCallback(provider?.legacyCallback ?? false);
    const config = provider?.config ?? {};
    const next = { ...EMPTY_FIELDS };
    for (const key of Object.keys(next) as Array<keyof Fields>) {
      const value = config[key];
      if (typeof value === "string") next[key] = value;
    }
    next.client_secret = "";
    setFields(next);
  }, [open, provider]);

  const set = (key: keyof Fields) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  const simplified = type !== "oidc";

  async function save() {
    if (!name.trim()) {
      toast.error(t("providers.nameRequired"));
      return;
    }
    const config: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value.trim()) config[key] = value.trim();
    }
    const input: SsoProviderInput = {
      name: name.trim(),
      type,
      enabled,
      config,
      ...(isEdit ? { legacyCallback } : {}),
    };
    setSaving(true);
    try {
      if (provider) await api.update(provider.id, input);
      else await api.create(input);
      toast.success(t("providers.saved"));
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, t("providers.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  const secretHint = provider?.hasClientSecret
    ? t("fields.secretKeep")
    : undefined;
  const redirectUri = legacyCallback
    ? (provider?.redirectUri ?? newRedirectUri)
    : newRedirectUri;

  const text = (
    key: keyof Fields,
    label: string,
    placeholder: string,
    options: { required?: boolean; hint?: string } = {},
  ) => (
    <Field label={label} required={options.required} hint={options.hint}>
      <Input
        value={fields[key]}
        onChange={(e) => set(key)(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:max-w-xl max-h-[calc(100dvh-2rem)]">
        <DialogHeader className="px-4 pt-4 pb-3 pr-10 border-b border-border shrink-0">
          <DialogTitle className="text-lg font-bold">
            {isEdit ? t("providers.edit") : t("providers.add")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("providers.dialogDesc")}{" "}
            <a
              href={
                simplified
                  ? "https://docs.termix.site/features/authentication/github-google"
                  : "https://docs.termix.site/features/authentication/oidc"
              }
              target="_blank"
              rel="noreferrer"
              className="text-accent-brand hover:underline"
            >
              {t("providers.docsLink")}
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-6">
          <Section title={t("providers.sectionGeneral")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("providers.name")} required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("providers.namePlaceholder")}
                />
              </Field>
              <Field label={t("providers.type")}>
                <Select2
                  value={type}
                  disabled={isEdit}
                  onChange={(e) => setType(e.target.value as SsoProviderType)}
                  className="w-full"
                >
                  {(Object.keys(TYPE_LABELS) as SsoProviderType[]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {TYPE_LABELS[value]}
                      </option>
                    ),
                  )}
                </Select2>
              </Field>
            </div>
            <div className="border border-border px-3">
              <SettingRow
                label={t("providers.enabled")}
                description={t("providers.enabledDesc")}
              >
                <FakeSwitch checked={enabled} onChange={setEnabled} />
              </SettingRow>
            </div>
          </Section>

          <Section title={t("providers.redirectUri")}>
            <div className="flex flex-col gap-1.5">
              <RedirectUri uri={redirectUri} />
              <p className="text-[10px] text-muted-foreground leading-snug">
                {t("providers.redirectUriDesc")}
              </p>
            </div>
            {isEdit && provider.legacyCallback && (
              <div className="border border-border px-3">
                <SettingRow
                  label={t("providers.legacyCallback")}
                  description={t("providers.legacyCallbackDesc", {
                    uri: newRedirectUri,
                  })}
                >
                  <FakeSwitch
                    checked={legacyCallback}
                    onChange={setLegacyCallback}
                  />
                </SettingRow>
              </div>
            )}
          </Section>

          <Section title={t("providers.sectionCredentials")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {text("client_id", t("fields.clientId"), "your-client-id", {
                required: true,
              })}
              <Field
                label={t("fields.clientSecret")}
                required={!provider?.hasClientSecret}
                hint={secretHint}
              >
                <PasswordInput
                  value={fields.client_secret}
                  onChange={(e) => set("client_secret")(e.target.value)}
                  placeholder="your-client-secret"
                />
              </Field>
            </div>
            {simplified ? (
              <p className="text-[10px] text-muted-foreground break-all">
                {t("providers.authorizationUrl", {
                  url: AUTHORIZATION_URLS[type as "github" | "google"],
                })}
              </p>
            ) : (
              <>
                {text("issuer_url", t("fields.issuerUrl"), "https://provider", {
                  required: true,
                })}
                {text(
                  "authorization_url",
                  t("fields.authUrl"),
                  "https://provider/oauth2/auth",
                  { required: true },
                )}
                {text(
                  "token_url",
                  t("fields.tokenUrl"),
                  "https://provider/oauth2/token",
                  { required: true },
                )}
                {text(
                  "userinfo_url",
                  t("fields.userinfoUrl"),
                  "https://provider/oauth2/userinfo",
                )}
              </>
            )}
          </Section>

          {!simplified && (
            <Section title={t("providers.sectionClaims")}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {text("identifier_path", t("fields.userIdentifier"), "sub", {
                  required: true,
                })}
                {text("name_path", t("fields.displayName"), "name", {
                  required: true,
                })}
              </div>
              {text("scopes", t("fields.scopes"), "openid email profile", {
                required: true,
              })}
              {text("group_claim", t("fields.groupClaim"), "groups", {
                hint: t("fields.groupClaimDesc"),
              })}
            </Section>
          )}

          <Section title={t("providers.sectionAccess")}>
            <Field
              label={t("fields.allowedUsers")}
              hint={t("fields.allowedUsersDesc")}
            >
              <Textarea
                value={fields.allowed_users}
                onChange={(e) => set("allowed_users")(e.target.value)}
                placeholder={"user@example.com\nanother@example.com"}
                rows={3}
                className="font-mono resize-y"
              />
            </Field>
            {text("admin_group", t("fields.adminGroup"), "admin", {
              hint: t("fields.adminGroupDesc"),
            })}
            <Field label={t("fields.caCert")} hint={t("fields.caCertDesc")}>
              <Textarea
                value={fields.ca_cert}
                onChange={(e) => set("ca_cert")(e.target.value)}
                placeholder={
                  "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                }
                rows={4}
                className="font-mono resize-y"
              />
            </Field>
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("providers.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={save}
            disabled={saving}
          >
            {saving ? t("providers.saving") : t("providers.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "providers" custom field on the plugin's admin settings page: the
 * provider list with an editor, which a schema field cannot express.
 */
export function ProvidersSetting() {
  const { t } = useTranslation();
  const api = createSsoApi(usePluginApi());
  const [providers, setProviders] = useState<SsoProvider[] | null>(null);
  const [newRedirectUri, setNewRedirectUri] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SsoProvider | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.list();
      setProviders(result.providers);
      setNewRedirectUri(result.newRedirectUri);
    } catch (error) {
      setProviders([]);
      toast.error(errorMessage(error, t("providers.loadFailed")));
    }
    // api is rebuilt each render from the same client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(provider: SsoProvider) {
    try {
      await api.update(provider.id, { enabled: !provider.enabled });
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t("providers.saveFailed")));
    }
  }

  async function remove(provider: SsoProvider) {
    if (!window.confirm(t("providers.deleteConfirm"))) return;
    try {
      await api.remove(provider.id);
      toast.success(t("providers.deleted"));
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t("providers.deleteFailed")));
    }
  }

  if (providers === null) return null;

  return (
    <div className="flex flex-col gap-3 py-3 border-b border-border last:border-0">
      <span className="text-[10px] text-muted-foreground">
        <a
          href="https://docs.termix.site/features/authentication/sso-providers"
          target="_blank"
          rel="noreferrer"
          className="text-accent-brand hover:underline"
        >
          {t("providers.docsLink")}
        </a>
      </span>
      {providers.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("providers.none")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-col gap-2 p-3 border border-border bg-background"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">
                    {provider.name}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 bg-muted text-muted-foreground font-mono uppercase shrink-0">
                    {TYPE_LABELS[provider.type] ?? provider.type}
                  </span>
                </div>
                <FakeSwitch
                  checked={provider.enabled}
                  onChange={() => void toggleEnabled(provider)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setEditing(provider);
                    setDialogOpen(true);
                  }}
                  title={t("providers.edit")}
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void remove(provider)}
                  title={t("providers.delete")}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <RedirectUri uri={provider.redirectUri} />
            </div>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
      >
        <Plus className="size-3" />
        {t("providers.add")}
      </Button>
      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
        newRedirectUri={newRedirectUri}
        onSaved={() => void load()}
      />
    </div>
  );
}
