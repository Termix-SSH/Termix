import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select2,
  Switch,
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

const labelClass =
  "text-[10px] font-semibold text-muted-foreground uppercase tracking-widest";
const areaClass =
  "w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono";

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
    <div className="flex flex-col gap-1">
      <label className={labelClass}>
        {label}
        {required && <span className="text-accent-brand ml-1">*</span>}
      </label>
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
      {children}
    </div>
  );
}

function RedirectUri({ uri }: { uri: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <code className="flex-1 min-w-0 truncate text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-1">
        {uri}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("providers.edit") : t("providers.add")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Field label={t("providers.name")} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("providers.namePlaceholder")}
              className="text-xs"
            />
          </Field>

          {!isEdit && (
            <Field label={t("providers.type")}>
              <Select2
                value={type}
                onChange={(e) => setType(e.target.value as SsoProviderType)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
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
          )}

          <div className="flex items-center justify-between">
            <label className={labelClass}>{t("providers.enabled")}</label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <label className={labelClass}>{t("providers.redirectUri")}</label>
            <span className="text-[10px] text-muted-foreground">
              {t("providers.redirectUriDesc")}
            </span>
            <RedirectUri uri={redirectUri} />
            {isEdit && provider.legacyCallback && (
              <div className="flex items-start justify-between gap-3 pt-1">
                <span className="text-[10px] text-muted-foreground">
                  {t("providers.legacyCallbackDesc", {
                    uri: newRedirectUri,
                  })}
                </span>
                <Switch
                  checked={legacyCallback}
                  onCheckedChange={setLegacyCallback}
                  aria-label={t("providers.legacyCallback")}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <span className="text-[10px] text-muted-foreground">
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
            </span>
            <Field label={t("fields.clientId")} required>
              <Input
                value={fields.client_id}
                onChange={(e) => set("client_id")(e.target.value)}
                placeholder="your-client-id"
                className="text-xs"
              />
            </Field>
            <Field
              label={t("fields.clientSecret")}
              required={!provider?.hasClientSecret}
              hint={secretHint}
            >
              <Input
                type="password"
                value={fields.client_secret}
                onChange={(e) => set("client_secret")(e.target.value)}
                placeholder="your-client-secret"
                className="text-xs"
              />
            </Field>
            {simplified ? (
              <span className="text-[10px] text-muted-foreground">
                {t("providers.authorizationUrl", {
                  url: AUTHORIZATION_URLS[type as "github" | "google"],
                })}
              </span>
            ) : (
              <>
                <Field label={t("fields.issuerUrl")} required>
                  <Input
                    value={fields.issuer_url}
                    onChange={(e) => set("issuer_url")(e.target.value)}
                    placeholder="https://provider"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.authUrl")} required>
                  <Input
                    value={fields.authorization_url}
                    onChange={(e) => set("authorization_url")(e.target.value)}
                    placeholder="https://provider/oauth2/auth"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.tokenUrl")} required>
                  <Input
                    value={fields.token_url}
                    onChange={(e) => set("token_url")(e.target.value)}
                    placeholder="https://provider/oauth2/token"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.userIdentifier")} required>
                  <Input
                    value={fields.identifier_path}
                    onChange={(e) => set("identifier_path")(e.target.value)}
                    placeholder="sub"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.displayName")} required>
                  <Input
                    value={fields.name_path}
                    onChange={(e) => set("name_path")(e.target.value)}
                    placeholder="name"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.scopes")} required>
                  <Input
                    value={fields.scopes}
                    onChange={(e) => set("scopes")(e.target.value)}
                    placeholder="openid email profile"
                    className="text-xs"
                  />
                </Field>
                <Field label={t("fields.userinfoUrl")}>
                  <Input
                    value={fields.userinfo_url}
                    onChange={(e) => set("userinfo_url")(e.target.value)}
                    placeholder="https://provider/oauth2/userinfo"
                    className="text-xs"
                  />
                </Field>
                <Field
                  label={t("fields.groupClaim")}
                  hint={t("fields.groupClaimDesc")}
                >
                  <Input
                    value={fields.group_claim}
                    onChange={(e) => set("group_claim")(e.target.value)}
                    placeholder="groups"
                    className="text-xs"
                  />
                </Field>
              </>
            )}
            <Field
              label={t("fields.allowedUsers")}
              hint={t("fields.allowedUsersDesc")}
            >
              <textarea
                value={fields.allowed_users}
                onChange={(e) => set("allowed_users")(e.target.value)}
                placeholder={"user@example.com\nanother@example.com"}
                rows={3}
                className={areaClass}
              />
            </Field>
            <Field
              label={t("fields.adminGroup")}
              hint={t("fields.adminGroupDesc")}
            >
              <Input
                value={fields.admin_group}
                onChange={(e) => set("admin_group")(e.target.value)}
                placeholder="admin"
                className="text-xs"
              />
            </Field>
            <Field label={t("fields.caCert")} hint={t("fields.caCertDesc")}>
              <textarea
                value={fields.ca_cert}
                onChange={(e) => set("ca_cert")(e.target.value)}
                placeholder={
                  "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                }
                rows={4}
                className={areaClass}
              />
            </Field>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              {t("providers.cancel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={save}
              disabled={saving}
            >
              {saving ? t("providers.saving") : t("providers.save")}
            </Button>
          </div>
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
    <div className="flex flex-col gap-3">
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
        <span className="text-[10px] text-muted-foreground">
          {t("providers.none")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-col gap-1.5 p-2 border border-border bg-background"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">
                    {provider.name}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 bg-muted text-muted-foreground font-mono uppercase">
                    {TYPE_LABELS[provider.type] ?? provider.type}
                  </span>
                </div>
                <Switch
                  checked={provider.enabled}
                  onCheckedChange={() => void toggleEnabled(provider)}
                  aria-label={t("providers.enabled")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
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
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
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
