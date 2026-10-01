import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from "@termix/plugin-sdk/ui";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import { createLdapApi, type LdapProvider } from "./ldap-api";

type Fields = {
  host: string;
  port: string;
  useTLS: boolean;
  bindDN: string;
  bindPassword: string;
  userSearchBase: string;
  userSearchFilter: string;
  usernameAttribute: string;
  displayNameAttribute: string;
  groupSearchBase: string;
  adminGroup: string;
  allowedUsers: string;
};

const EMPTY_FIELDS: Fields = {
  host: "",
  port: "389",
  useTLS: false,
  bindDN: "",
  bindPassword: "",
  userSearchBase: "",
  userSearchFilter: "(uid={{username}})",
  usernameAttribute: "uid",
  displayNameAttribute: "cn",
  groupSearchBase: "",
  adminGroup: "",
  allowedUsers: "",
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

function ProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: LdapProvider | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = createLdapApi(usePluginApi());
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(provider?.name ?? "");
    setEnabled(provider?.enabled ?? true);
    const config = provider?.config ?? {};
    const next = { ...EMPTY_FIELDS };
    for (const key of Object.keys(next) as Array<keyof Fields>) {
      const value = config[key];
      if (key === "useTLS") next.useTLS = value === true;
      else if (key === "port" && value !== undefined) next.port = String(value);
      else if (typeof value === "string") next[key] = value as never;
    }
    next.bindPassword = "";
    setFields(next);
  }, [open, provider]);

  const set = (key: Exclude<keyof Fields, "useTLS">) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  async function save() {
    if (!name.trim()) {
      toast.error(t("providers.nameRequired"));
      return;
    }
    const config: Record<string, unknown> = {
      host: fields.host.trim(),
      port: Number.parseInt(fields.port, 10) || 389,
      useTLS: fields.useTLS,
      bindDN: fields.bindDN.trim(),
      userSearchBase: fields.userSearchBase.trim(),
      userSearchFilter: fields.userSearchFilter.trim(),
      usernameAttribute: fields.usernameAttribute.trim() || "uid",
      displayNameAttribute: fields.displayNameAttribute.trim() || "cn",
      groupSearchBase: fields.groupSearchBase.trim() || undefined,
      adminGroup: fields.adminGroup.trim() || undefined,
      allowedUsers: fields.allowedUsers.trim() || undefined,
    };
    if (fields.bindPassword) config.bindPassword = fields.bindPassword;
    setSaving(true);
    try {
      const input = { name: name.trim(), enabled, config };
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {provider ? t("providers.edit") : t("providers.add")}
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
          <div className="flex items-center justify-between">
            <label className={labelClass}>{t("providers.enabled")}</label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <span className="text-[10px] text-muted-foreground">
              <a
                href="https://docs.termix.site/features/authentication/ldap"
                target="_blank"
                rel="noreferrer"
                className="text-accent-brand hover:underline"
              >
                {t("providers.docsLink")}
              </a>
            </span>
            <Field label={t("fields.host")} required>
              <Input
                value={fields.host}
                onChange={(e) => set("host")(e.target.value)}
                placeholder="ldap.example.com"
                className="text-xs"
              />
            </Field>
            <div className="flex gap-2">
              <div className="flex-1">
                <Field label={t("fields.port")} required>
                  <Input
                    value={fields.port}
                    onChange={(e) => set("port")(e.target.value)}
                    placeholder="389"
                    className="text-xs"
                  />
                </Field>
              </div>
              <div className="flex items-end pb-1.5 gap-2">
                <Switch
                  checked={fields.useTLS}
                  onCheckedChange={(useTLS) =>
                    setFields((prev) => ({ ...prev, useTLS }))
                  }
                  aria-label={t("fields.useTls")}
                />
                <span className="text-[10px] text-muted-foreground">
                  {t("fields.useTls")}
                </span>
              </div>
            </div>
            <Field label={t("fields.bindDn")} required>
              <Input
                value={fields.bindDN}
                onChange={(e) => set("bindDN")(e.target.value)}
                placeholder="cn=admin,dc=example,dc=com"
                className="text-xs"
              />
            </Field>
            <Field
              label={t("fields.bindPassword")}
              required={!provider?.hasBindPassword}
              hint={
                provider?.hasBindPassword ? t("fields.secretKeep") : undefined
              }
            >
              <Input
                type="password"
                value={fields.bindPassword}
                onChange={(e) => set("bindPassword")(e.target.value)}
                className="text-xs"
              />
            </Field>
            <Field label={t("fields.userSearchBase")} required>
              <Input
                value={fields.userSearchBase}
                onChange={(e) => set("userSearchBase")(e.target.value)}
                placeholder="ou=users,dc=example,dc=com"
                className="text-xs"
              />
            </Field>
            <Field label={t("fields.userSearchFilter")} required>
              <Input
                value={fields.userSearchFilter}
                onChange={(e) => set("userSearchFilter")(e.target.value)}
                placeholder="(uid={{username}})"
                className="text-xs"
              />
            </Field>
            <Field label={t("fields.usernameAttr")} required>
              <Input
                value={fields.usernameAttribute}
                onChange={(e) => set("usernameAttribute")(e.target.value)}
                placeholder="uid"
                className="text-xs"
              />
            </Field>
            <Field label={t("fields.displayNameAttr")} required>
              <Input
                value={fields.displayNameAttribute}
                onChange={(e) => set("displayNameAttribute")(e.target.value)}
                placeholder="cn"
                className="text-xs"
              />
            </Field>
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <Field label={t("fields.groupSearchBase")}>
                <Input
                  value={fields.groupSearchBase}
                  onChange={(e) => set("groupSearchBase")(e.target.value)}
                  placeholder="ou=groups,dc=example,dc=com"
                  className="text-xs"
                />
              </Field>
              <Field label={t("fields.adminGroup")}>
                <Input
                  value={fields.adminGroup}
                  onChange={(e) => set("adminGroup")(e.target.value)}
                  placeholder="cn=admins,ou=groups,dc=example,dc=com"
                  className="text-xs"
                />
              </Field>
              <Field label={t("fields.allowedUsers")}>
                <Input
                  value={fields.allowedUsers}
                  onChange={(e) => set("allowedUsers")(e.target.value)}
                  placeholder="user1,user2,@domain.com"
                  className="text-xs"
                />
              </Field>
            </div>
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
 * directory list with an editor.
 */
export function ProvidersSetting() {
  const { t } = useTranslation();
  const api = createLdapApi(usePluginApi());
  const [providers, setProviders] = useState<LdapProvider[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LdapProvider | null>(null);

  const load = useCallback(async () => {
    try {
      setProviders(await api.list());
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

  async function toggleEnabled(provider: LdapProvider) {
    try {
      await api.update(provider.id, { enabled: !provider.enabled });
      await load();
    } catch (error) {
      toast.error(errorMessage(error, t("providers.saveFailed")));
    }
  }

  async function remove(provider: LdapProvider) {
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
      {providers.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">
          {t("providers.none")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-2 p-2 border border-border bg-background"
            >
              <span className="flex-1 min-w-0 text-xs font-medium truncate">
                {provider.name}
              </span>
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
        onSaved={() => void load()}
      />
    </div>
  );
}
