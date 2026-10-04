import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
  SettingRow,
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

  const text = (
    key: Exclude<keyof Fields, "useTLS" | "bindPassword">,
    label: string,
    placeholder: string,
    required = false,
  ) => (
    <Field label={label} required={required}>
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
            {provider ? t("providers.edit") : t("providers.add")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("providers.dialogDesc")}{" "}
            <a
              href="https://docs.termix.site/features/authentication/ldap"
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
            <Field label={t("providers.name")} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("providers.namePlaceholder")}
              />
            </Field>
            <div className="border border-border px-3">
              <SettingRow
                label={t("providers.enabled")}
                description={t("providers.enabledDesc")}
              >
                <FakeSwitch checked={enabled} onChange={setEnabled} />
              </SettingRow>
            </div>
          </Section>

          <Section title={t("providers.sectionConnection")}>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
              {text("host", t("fields.host"), "ldap.example.com", true)}
              {text("port", t("fields.port"), "389", true)}
            </div>
            <div className="border border-border px-3">
              <SettingRow
                label={t("fields.useTls")}
                description={t("fields.useTlsDesc")}
              >
                <FakeSwitch
                  checked={fields.useTLS}
                  onChange={(useTLS) =>
                    setFields((prev) => ({ ...prev, useTLS }))
                  }
                />
              </SettingRow>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {text(
                "bindDN",
                t("fields.bindDn"),
                "cn=admin,dc=example,dc=com",
                true,
              )}
              <Field
                label={t("fields.bindPassword")}
                required={!provider?.hasBindPassword}
                hint={
                  provider?.hasBindPassword ? t("fields.secretKeep") : undefined
                }
              >
                <PasswordInput
                  value={fields.bindPassword}
                  onChange={(e) => set("bindPassword")(e.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title={t("providers.sectionUsers")}>
            {text(
              "userSearchBase",
              t("fields.userSearchBase"),
              "ou=users,dc=example,dc=com",
              true,
            )}
            {text(
              "userSearchFilter",
              t("fields.userSearchFilter"),
              "(uid={{username}})",
              true,
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {text("usernameAttribute", t("fields.usernameAttr"), "uid", true)}
              {text(
                "displayNameAttribute",
                t("fields.displayNameAttr"),
                "cn",
                true,
              )}
            </div>
          </Section>

          <Section title={t("providers.sectionAccess")}>
            {text(
              "groupSearchBase",
              t("fields.groupSearchBase"),
              "ou=groups,dc=example,dc=com",
            )}
            {text(
              "adminGroup",
              t("fields.adminGroup"),
              "cn=admins,ou=groups,dc=example,dc=com",
            )}
            {text(
              "allowedUsers",
              t("fields.allowedUsers"),
              "user1,user2,@domain.com",
            )}
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
    <div className="flex flex-col gap-3 py-3 border-b border-border last:border-0">
      {providers.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("providers.none")}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-2 p-3 border border-border bg-background"
            >
              <span className="flex-1 min-w-0 text-sm font-medium truncate">
                {provider.name}
              </span>
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
