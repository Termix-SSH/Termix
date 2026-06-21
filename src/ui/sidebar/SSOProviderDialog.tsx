import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { toast } from "sonner";
import type { SSOProvider, SSOProviderType } from "@/types/index";
import type { OIDCProviderConfig, LDAPProviderConfig } from "@/types/index";
import { createSSOProvider, updateSSOProvider } from "@/api/sso-provider-api";

type ApiErrorLike = {
  response?: { data?: { error?: string } };
  message?: string;
};

function apiErrorMsg(error: unknown, fallback: string) {
  const err = error as ApiErrorLike;
  return err.response?.data?.error || err.message || fallback;
}

const PROVIDER_TYPE_OPTIONS: { value: SSOProviderType; label: string }[] = [
  { value: "oidc", label: "OIDC" },
  { value: "github", label: "GitHub" },
  { value: "google", label: "Google" },
  { value: "ldap", label: "LDAP" },
];

type SSOProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: SSOProvider | null;
  onSaved: (provider: SSOProvider) => void;
};

function emptyOidc(): OIDCProviderConfig {
  return {
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
}

function emptyLdap(): LDAPProviderConfig {
  return {
    host: "",
    port: 389,
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
}

type OIDCFields = {
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

type LDAPFields = {
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

export function SSOProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: SSOProviderDialogProps) {
  const { t } = useTranslation();
  const isEdit = provider != null;

  const [name, setName] = useState("");
  const [type, setType] = useState<SSOProviderType>("oidc");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const [oidc, setOidc] = useState<OIDCFields>(
    () => ({ ...emptyOidc() }) as OIDCFields,
  );
  const [ldap, setLdap] = useState<LDAPFields>(() => {
    const d = emptyLdap();
    return { ...d, port: String(d.port) };
  });

  useEffect(() => {
    if (!open) return;
    if (provider) {
      setName(provider.name);
      setType(provider.type);
      setEnabled(provider.enabled);
      let config: Record<string, unknown> = {};
      if (typeof provider.config === "string") {
        try {
          config = JSON.parse(provider.config);
        } catch {
          /* */
        }
      } else if (provider.config && typeof provider.config === "object") {
        config = provider.config as Record<string, unknown>;
      }
      if (provider.type === "ldap") {
        const d = emptyLdap();
        setLdap({
          host: (config.host as string) ?? d.host,
          port: String((config.port as number) ?? d.port),
          useTLS: (config.useTLS as boolean) ?? d.useTLS,
          bindDN: (config.bindDN as string) ?? d.bindDN,
          bindPassword: (config.bindPassword as string) ?? "",
          userSearchBase: (config.userSearchBase as string) ?? d.userSearchBase,
          userSearchFilter:
            (config.userSearchFilter as string) ?? d.userSearchFilter,
          usernameAttribute:
            (config.usernameAttribute as string) ?? d.usernameAttribute,
          displayNameAttribute:
            (config.displayNameAttribute as string) ?? d.displayNameAttribute,
          groupSearchBase: (config.groupSearchBase as string) ?? "",
          adminGroup: (config.adminGroup as string) ?? "",
          allowedUsers: (config.allowedUsers as string) ?? "",
        });
      } else {
        const d = emptyOidc();
        setOidc({
          client_id: (config.client_id as string) ?? d.client_id,
          client_secret: (config.client_secret as string) ?? "",
          issuer_url: (config.issuer_url as string) ?? d.issuer_url,
          authorization_url:
            (config.authorization_url as string) ?? d.authorization_url,
          token_url: (config.token_url as string) ?? d.token_url,
          userinfo_url: (config.userinfo_url as string) ?? d.userinfo_url,
          identifier_path:
            (config.identifier_path as string) ?? d.identifier_path,
          name_path: (config.name_path as string) ?? d.name_path,
          scopes: (config.scopes as string) ?? d.scopes,
          allowed_users: (config.allowed_users as string) ?? d.allowed_users,
          admin_group: (config.admin_group as string) ?? d.admin_group,
          group_claim: (config.group_claim as string) ?? "",
          ca_cert: (config.ca_cert as string) ?? "",
        });
      }
    } else {
      setName("");
      setType("oidc");
      setEnabled(true);
      setOidc({ ...emptyOidc() } as OIDCFields);
      const d = emptyLdap();
      setLdap({ ...d, port: String(d.port) });
    }
  }, [open, provider]);

  function setOidcField<K extends keyof OIDCFields>(
    field: K,
    value: OIDCFields[K],
  ) {
    setOidc((prev) => ({ ...prev, [field]: value }));
  }

  function setLdapField<K extends keyof LDAPFields>(
    field: K,
    value: LDAPFields[K],
  ) {
    setLdap((prev) => ({ ...prev, [field]: value }));
  }

  function buildConfig(): Record<string, unknown> {
    if (type === "ldap") {
      return {
        host: ldap.host,
        port: parseInt(ldap.port, 10) || 389,
        useTLS: ldap.useTLS,
        bindDN: ldap.bindDN,
        bindPassword: ldap.bindPassword,
        userSearchBase: ldap.userSearchBase,
        userSearchFilter: ldap.userSearchFilter,
        usernameAttribute: ldap.usernameAttribute || "uid",
        displayNameAttribute: ldap.displayNameAttribute || "cn",
        groupSearchBase: ldap.groupSearchBase || undefined,
        adminGroup: ldap.adminGroup || undefined,
        allowedUsers: ldap.allowedUsers || undefined,
      };
    }
    const providerDefaults =
      type === "google"
        ? googleDefaults
        : type === "github"
          ? githubDefaults
          : null;
    return {
      client_id: oidc.client_id,
      client_secret: oidc.client_secret,
      issuer_url: oidc.issuer_url || providerDefaults?.issuer_url || "",
      authorization_url:
        oidc.authorization_url || providerDefaults?.authorization_url || "",
      token_url: oidc.token_url || providerDefaults?.token_url || "",
      userinfo_url:
        oidc.userinfo_url || providerDefaults?.userinfo_url || undefined,
      identifier_path:
        oidc.identifier_path || providerDefaults?.identifier_path || "sub",
      name_path: oidc.name_path || providerDefaults?.name_path || "name",
      scopes: oidc.scopes || providerDefaults?.scopes || "openid email profile",
      allowed_users: oidc.allowed_users || undefined,
      admin_group: oidc.admin_group || undefined,
      group_claim: oidc.group_claim || undefined,
      ca_cert: oidc.ca_cert || undefined,
    };
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(
        t("admin.ssoProviderName") + " " + t("common.required").toLowerCase(),
      );
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        type,
        enabled,
        displayOrder: 0,
        config: buildConfig(),
      };
      let saved: SSOProvider;
      if (isEdit && provider) {
        saved = await updateSSOProvider(provider.id, data);
      } else {
        saved = await createSSOProvider(data);
      }
      toast.success(t("common.saved"));
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMsg(err, t("common.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  const isGithubOrGoogle = type === "github" || type === "google";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("admin.ssoEditProvider") : t("admin.ssoAddProvider")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("admin.ssoProviderName")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My SSO Provider"
              className="text-xs"
            />
          </div>

          {!isEdit && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("admin.ssoProviderType")}
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SSOProviderType)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                {PROVIDER_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("admin.ssoEnabled")}
            </label>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${enabled ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
            >
              <span
                className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div className="border-t border-border pt-3">
            {type === "ldap" ? (
              <LDAPConfigFields ldap={ldap} setLdapField={setLdapField} t={t} />
            ) : (
              <OIDCConfigFields
                oidc={oidc}
                setOidcField={setOidcField}
                type={type}
                simplified={isGithubOrGoogle}
                t={t}
              />
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="text-xs bg-accent-brand text-white hover:bg-accent-brand/90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t("admin.saving") : t("admin.ssoSaveProvider")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
        {required && <span className="text-accent-brand ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function OIDCConfigFields({
  oidc,
  setOidcField,
  type,
  simplified,
  t,
}: {
  oidc: OIDCFields;
  setOidcField: <K extends keyof OIDCFields>(k: K, v: OIDCFields[K]) => void;
  type: SSOProviderType;
  simplified: boolean;
  t: (key: string) => string;
}) {
  const githubDefaults = {
    authorization_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    issuer_url: "https://token.actions.githubusercontent.com",
    userinfo_url: "https://api.github.com/user",
    scopes: "read:user user:email",
    identifier_path: "id",
    name_path: "name",
  };
  const googleDefaults = {
    authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    issuer_url: "https://accounts.google.com",
    userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: "openid email profile",
    identifier_path: "sub",
    name_path: "name",
  };
  const docsHref = simplified
    ? "https://docs.termix.site/features/authentication/github-google"
    : "https://docs.termix.site/features/authentication/oidc";

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] text-muted-foreground">
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="text-accent-brand hover:underline"
        >
          {t("admin.ssoProviderDocsLink")}
        </a>
      </span>
      <Field label={t("admin.oidcClientId")} required>
        <Input
          value={oidc.client_id}
          onChange={(e) => setOidcField("client_id", e.target.value)}
          placeholder="your-client-id"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.oidcClientSecret")} required>
        <Input
          type="password"
          value={oidc.client_secret}
          onChange={(e) => setOidcField("client_secret", e.target.value)}
          placeholder="your-client-secret"
          className="text-xs"
        />
      </Field>
      {simplified ? (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">
            {type === "github"
              ? `Authorization URL: ${githubDefaults.authorization_url}`
              : `Authorization URL: ${googleDefaults.authorization_url}`}
          </span>
        </div>
      ) : (
        <>
          <Field label={t("admin.oidcIssuerUrl")} required>
            <Input
              value={oidc.issuer_url}
              onChange={(e) => setOidcField("issuer_url", e.target.value)}
              placeholder="https://provider"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcAuthUrl")} required>
            <Input
              value={oidc.authorization_url}
              onChange={(e) =>
                setOidcField("authorization_url", e.target.value)
              }
              placeholder="https://provider/oauth2/auth"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcTokenUrl")} required>
            <Input
              value={oidc.token_url}
              onChange={(e) => setOidcField("token_url", e.target.value)}
              placeholder="https://provider/oauth2/token"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcUserIdentifier")} required>
            <Input
              value={oidc.identifier_path}
              onChange={(e) => setOidcField("identifier_path", e.target.value)}
              placeholder="sub"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcDisplayName")} required>
            <Input
              value={oidc.name_path}
              onChange={(e) => setOidcField("name_path", e.target.value)}
              placeholder="name"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcScopes")} required>
            <Input
              value={oidc.scopes}
              onChange={(e) => setOidcField("scopes", e.target.value)}
              placeholder="openid email profile"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcUserinfoUrl")}>
            <Input
              value={oidc.userinfo_url}
              onChange={(e) => setOidcField("userinfo_url", e.target.value)}
              placeholder="https://provider/oauth2/userinfo"
              className="text-xs"
            />
          </Field>
          <Field label={t("admin.oidcGroupClaim")}>
            <Input
              value={oidc.group_claim}
              onChange={(e) => setOidcField("group_claim", e.target.value)}
              placeholder="groups"
              className="text-xs"
            />
          </Field>
        </>
      )}
      <Field label={t("admin.oidcAllowedUsers")}>
        <span className="text-[10px] text-muted-foreground">
          {t("admin.oidcAllowedUsersDesc")}
        </span>
        <textarea
          value={oidc.allowed_users}
          onChange={(e) => setOidcField("allowed_users", e.target.value)}
          placeholder={"user@example.com\nanother@example.com"}
          rows={3}
          className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      </Field>
      <Field label={t("admin.oidcAdminGroup")}>
        <span className="text-[10px] text-muted-foreground">
          {t("admin.oidcAdminGroupDesc")}
        </span>
        <Input
          value={oidc.admin_group}
          onChange={(e) => setOidcField("admin_group", e.target.value)}
          placeholder="admin"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.oidcCaCert")}>
        <span className="text-[10px] text-muted-foreground">
          {t("admin.oidcCaCertDesc")}
        </span>
        <textarea
          value={oidc.ca_cert}
          onChange={(e) => setOidcField("ca_cert", e.target.value)}
          placeholder={
            "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
          }
          rows={4}
          className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
        />
      </Field>
    </div>
  );
}

function LDAPConfigFields({
  ldap,
  setLdapField,
  t,
}: {
  ldap: LDAPFields;
  setLdapField: <K extends keyof LDAPFields>(k: K, v: LDAPFields[K]) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] text-muted-foreground">
        <a
          href="https://docs.termix.site/features/authentication/ldap"
          target="_blank"
          rel="noreferrer"
          className="text-accent-brand hover:underline"
        >
          {t("admin.ssoProviderDocsLink")}
        </a>
      </span>
      <Field label={t("admin.ldapHost")} required>
        <Input
          value={ldap.host}
          onChange={(e) => setLdapField("host", e.target.value)}
          placeholder="ldap.example.com"
          className="text-xs"
        />
      </Field>
      <div className="flex gap-2">
        <div className="flex-1">
          <Field label={t("admin.ldapPort")} required>
            <Input
              value={ldap.port}
              onChange={(e) => setLdapField("port", e.target.value)}
              placeholder="389"
              className="text-xs"
            />
          </Field>
        </div>
        <div className="flex items-end pb-0.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLdapField("useTLS", !ldap.useTLS)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${ldap.useTLS ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
            >
              <span
                className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${ldap.useTLS ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
            <span className="text-[10px] text-muted-foreground">
              {t("admin.ldapUseTls")}
            </span>
          </div>
        </div>
      </div>
      <Field label={t("admin.ldapBindDn")} required>
        <Input
          value={ldap.bindDN}
          onChange={(e) => setLdapField("bindDN", e.target.value)}
          placeholder="cn=admin,dc=example,dc=com"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.ldapBindPassword")} required>
        <Input
          type="password"
          value={ldap.bindPassword}
          onChange={(e) => setLdapField("bindPassword", e.target.value)}
          placeholder="bind password"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.ldapUserSearchBase")} required>
        <Input
          value={ldap.userSearchBase}
          onChange={(e) => setLdapField("userSearchBase", e.target.value)}
          placeholder="ou=users,dc=example,dc=com"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.ldapUserSearchFilter")} required>
        <Input
          value={ldap.userSearchFilter}
          onChange={(e) => setLdapField("userSearchFilter", e.target.value)}
          placeholder="(uid={{username}})"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.ldapUsernameAttr")} required>
        <Input
          value={ldap.usernameAttribute}
          onChange={(e) => setLdapField("usernameAttribute", e.target.value)}
          placeholder="uid"
          className="text-xs"
        />
      </Field>
      <Field label={t("admin.ldapDisplayNameAttr")} required>
        <Input
          value={ldap.displayNameAttribute}
          onChange={(e) => setLdapField("displayNameAttribute", e.target.value)}
          placeholder="cn"
          className="text-xs"
        />
      </Field>
      <div className="border-t border-border pt-3 flex flex-col gap-3">
        <span className="text-[10px] text-muted-foreground">
          {t("admin.ldapGroupSearchBase")}
        </span>
        <Field label={t("admin.ldapGroupSearchBase")}>
          <Input
            value={ldap.groupSearchBase}
            onChange={(e) => setLdapField("groupSearchBase", e.target.value)}
            placeholder="ou=groups,dc=example,dc=com"
            className="text-xs"
          />
        </Field>
        <Field label={t("admin.ldapAdminGroup")}>
          <Input
            value={ldap.adminGroup}
            onChange={(e) => setLdapField("adminGroup", e.target.value)}
            placeholder="cn=admins,ou=groups,dc=example,dc=com"
            className="text-xs"
          />
        </Field>
        <Field label={t("admin.ldapAllowedUsers")}>
          <Input
            value={ldap.allowedUsers}
            onChange={(e) => setLdapField("allowedUsers", e.target.value)}
            placeholder="user1,user2,@domain.com"
            className="text-xs"
          />
        </Field>
      </div>
    </div>
  );
}
