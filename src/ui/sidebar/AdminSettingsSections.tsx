import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { SettingRow } from "@/components/section-card";
import { Database, Lock, RefreshCw, Server, Settings } from "lucide-react";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";
import type { HostDefaults } from "@/api/settings-api";
import type { TlsStatus } from "@/api/tls-api";

type GeneralSettingsSectionProps = {
  open: boolean;
  onToggle: () => void;
  analyticsEnabled: boolean;
  analyticsLocked: boolean;
  handleToggleAnalytics: () => void;
  notificationPrivateEndpoints: string[];
  onSaveNotificationPrivateEndpoints: (hosts: string[]) => void;
  allowRegistration: boolean;
  handleToggleRegistration: () => void;
  allowPasswordLogin: boolean;
  passwordLoginForced?: boolean;
  handleTogglePasswordLogin: () => void;
  oidcAutoProvision: boolean;
  handleToggleOidcAutoProvision: () => void;
  secondFactorAfterExternalLogin: boolean;
  handleToggleSecondFactorAfterExternalLogin: () => void;
  oidcSilentLoginDefault: boolean;
  oidcSilentLoginDefaultLocked: boolean;
  handleToggleOidcSilentLoginDefault: () => void;
  allowPasswordReset: boolean;
  handleTogglePasswordReset: () => void;
  sessionTimeout: string;
  setSessionTimeout: Dispatch<SetStateAction<string>>;
  handleSaveSessionTimeout: () => void;
  statusInterval: string;
  setStatusInterval: Dispatch<SetStateAction<string>>;
  handleSaveMonitoring: () => void;
  logLevel: string;
  handleSaveLogLevel: (level: string) => void;
};

export function AdminGeneralSettingsSection({
  open,
  onToggle,
  analyticsEnabled,
  analyticsLocked,
  handleToggleAnalytics,
  notificationPrivateEndpoints,
  onSaveNotificationPrivateEndpoints,
  allowRegistration,
  handleToggleRegistration,
  allowPasswordLogin,
  passwordLoginForced,
  handleTogglePasswordLogin,
  oidcAutoProvision,
  handleToggleOidcAutoProvision,
  secondFactorAfterExternalLogin,
  handleToggleSecondFactorAfterExternalLogin,
  oidcSilentLoginDefault,
  oidcSilentLoginDefaultLocked,
  handleToggleOidcSilentLoginDefault,
  allowPasswordReset,
  handleTogglePasswordReset,
  sessionTimeout,
  setSessionTimeout,
  handleSaveSessionTimeout,
  statusInterval,
  setStatusInterval,
  handleSaveMonitoring,
  logLevel,
  handleSaveLogLevel,
}: GeneralSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionGeneral")}
      icon={<Settings className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-0 pt-2">
        <SettingRow
          label={t("admin.analyticsEnabled")}
          description={
            analyticsLocked
              ? t("admin.analyticsEnabledLockedDesc")
              : t("admin.analyticsEnabledDesc")
          }
        >
          <AdminToggle
            on={analyticsEnabled}
            onToggle={handleToggleAnalytics}
            disabled={analyticsLocked}
          />
        </SettingRow>
        <div className="flex flex-col gap-1.5 py-2">
          <span className="text-xs font-medium">
            {t("admin.notificationPrivateEndpoints")}
          </span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            {t("admin.notificationPrivateEndpointsDesc")}
          </span>
          <Input
            className="rounded-none"
            defaultValue={notificationPrivateEndpoints.join(", ")}
            placeholder="ntfy.internal, 192.168.1.20"
            onBlur={(event) =>
              onSaveNotificationPrivateEndpoints(
                event.target.value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
        <div className="border-t border-border pt-3 mt-2">
          <SettingRow
            label={t("admin.allowRegistration")}
            description={t("admin.allowRegistrationDesc")}
          >
            <AdminToggle
              on={allowRegistration}
              onToggle={handleToggleRegistration}
            />
          </SettingRow>
        </div>
        <SettingRow
          label={t("admin.allowPasswordLogin")}
          description={t("admin.allowPasswordLoginDesc")}
        >
          <AdminToggle
            on={allowPasswordLogin}
            onToggle={handleTogglePasswordLogin}
          />
        </SettingRow>
        {passwordLoginForced && (
          <p className="text-[10px] text-destructive">
            {t("admin.passwordLoginForced")}
          </p>
        )}
        <SettingRow
          label={t("admin.oidcAutoProvision")}
          description={t("admin.oidcAutoProvisionDesc")}
        >
          <AdminToggle
            on={oidcAutoProvision}
            onToggle={handleToggleOidcAutoProvision}
          />
        </SettingRow>
        <SettingRow
          label={t("admin.secondFactorAfterExternalLogin")}
          description={t("admin.secondFactorAfterExternalLoginDesc")}
        >
          <AdminToggle
            on={secondFactorAfterExternalLogin}
            onToggle={handleToggleSecondFactorAfterExternalLogin}
          />
        </SettingRow>
        <SettingRow
          label={t("admin.oidcSilentLoginDefault")}
          description={
            oidcSilentLoginDefaultLocked
              ? t("admin.oidcSilentLoginDefaultLockedDesc")
              : t("admin.oidcSilentLoginDefaultDesc")
          }
        >
          <AdminToggle
            on={oidcSilentLoginDefault}
            onToggle={handleToggleOidcSilentLoginDefault}
            disabled={oidcSilentLoginDefaultLocked}
          />
        </SettingRow>
        <SettingRow
          label={t("admin.allowPasswordReset")}
          description={t("admin.allowPasswordResetDesc")}
        >
          <AdminToggle
            on={allowPasswordReset}
            onToggle={handleTogglePasswordReset}
          />
        </SettingRow>
        <div className="flex flex-col gap-2 pt-3 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.sessionTimeout")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={720}
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="w-20 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              {t("admin.hours")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
              onClick={handleSaveSessionTimeout}
            >
              {t("common.save")}
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {t("admin.sessionTimeoutRange")}
          </span>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.monitoringDefaults")}
          </span>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("admin.statusCheck")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={statusInterval}
                onChange={(e) => setStatusInterval(e.target.value)}
                className="w-20 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                {t("admin.sec")}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
                onClick={handleSaveMonitoring}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.logLevel")}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {["debug", "info", "warn", "error"].map((l) => (
              <button
                key={l}
                onClick={() => handleSaveLogLevel(l)}
                className={`px-2 py-1 text-[10px] font-semibold border capitalize transition-colors ${logLevel === l ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </AccordionSection>
  );
}

type DatabaseSectionProps = {
  open: boolean;
  onToggle: () => void;
  importFile: File | null;
  setImportFile: Dispatch<SetStateAction<File | null>>;
  exportLoading: boolean;
  importLoading: boolean;
  handleExportDatabase: () => void;
  handleImportDatabase: () => void;
};

export function AdminDatabaseSection({
  open,
  onToggle,
  importFile,
  setImportFile,
  exportLoading,
  importLoading,
  handleExportDatabase,
  handleImportDatabase,
}: DatabaseSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionDatabase")}
      icon={<Database className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-3 pt-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">
            {t("admin.exportDatabase")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("admin.exportDatabaseDesc")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand mt-1"
            onClick={handleExportDatabase}
            disabled={exportLoading}
          >
            {exportLoading ? t("admin.exporting") : t("admin.export")}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className="text-xs font-medium">
            {t("admin.importDatabase")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {importFile
              ? t("admin.importDatabaseSelected", { name: importFile.name })
              : t("admin.importDatabaseDesc")}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="relative">
              <input
                type="file"
                accept=".sqlite,.db"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Button
                variant="outline"
                size="sm"
                className="pointer-events-none text-xs"
              >
                {importFile ? t("admin.changeFile") : t("admin.selectFile")}
              </Button>
            </div>
            {importFile && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={handleImportDatabase}
                disabled={importLoading}
              >
                {importLoading ? t("admin.importing") : t("admin.import")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AccordionSection>
  );
}

type AdminHostDefaultsSectionProps = {
  open: boolean;
  onToggle: () => void;
  defaults: HostDefaults;
  setDefaults: Dispatch<SetStateAction<HostDefaults>>;
  handleSaveDefaults: () => void;
};

export function AdminHostDefaultsSection({
  open,
  onToggle,
  defaults,
  setDefaults,
  handleSaveDefaults,
}: AdminHostDefaultsSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionHostDefaults")}
      icon={<Server className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-4 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {t("admin.hostDefaultsDesc")}
        </span>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.hostDefaultsSocks5")}
          </span>
          <SettingRow
            label={t("admin.hostDefaultsUseSocks5")}
            description={t("admin.hostDefaultsUseSocks5Desc")}
          >
            <AdminToggle
              on={defaults.useSocks5 ?? false}
              onToggle={() =>
                setDefaults((p) => ({ ...p, useSocks5: !p.useSocks5 }))
              }
            />
          </SettingRow>
          {defaults.useSocks5 && (
            <div className="flex flex-col gap-3 ml-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.hostDefaultsSocks5Host")}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={defaults.socks5Host ?? ""}
                    onChange={(e) =>
                      setDefaults((p) => ({ ...p, socks5Host: e.target.value }))
                    }
                    placeholder="127.0.0.1"
                    className="text-xs"
                  />
                  <Input
                    type="number"
                    value={defaults.socks5Port ?? 1080}
                    onChange={(e) =>
                      setDefaults((p) => ({
                        ...p,
                        socks5Port: Number(e.target.value),
                      }))
                    }
                    placeholder="1080"
                    className="text-xs w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.hostDefaultsSocks5Username")}
                </label>
                <Input
                  value={defaults.socks5Username ?? ""}
                  onChange={(e) =>
                    setDefaults((p) => ({
                      ...p,
                      socks5Username: e.target.value,
                    }))
                  }
                  className="text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.hostDefaultsSocks5Password")}
                </label>
                <PasswordInput
                  value={defaults.socks5Password ?? ""}
                  onChange={(e) =>
                    setDefaults((p) => ({
                      ...p,
                      socks5Password: e.target.value,
                    }))
                  }
                  className="h-8 text-xs pr-8"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.hostDefaultsStatus")}
          </span>
          <SettingRow
            label={t("admin.hostDefaultsStatusCheckEnabled")}
            description={t("admin.hostDefaultsStatusCheckEnabledDesc")}
          >
            <AdminToggle
              on={defaults.statusCheckEnabled ?? true}
              onToggle={() =>
                setDefaults((p) => ({
                  ...p,
                  statusCheckEnabled: !(p.statusCheckEnabled ?? true),
                }))
              }
            />
          </SettingRow>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.hostDefaultsTerminal")}
          </span>
          <SettingRow
            label={t("admin.hostDefaultsAutoTmux")}
            description={t("admin.hostDefaultsAutoTmuxDesc")}
          >
            <AdminToggle
              on={defaults.autoTmux ?? false}
              onToggle={() =>
                setDefaults((p) => ({ ...p, autoTmux: !(p.autoTmux ?? false) }))
              }
            />
          </SettingRow>
          <SettingRow
            label={t("admin.hostDefaultsSessionLogging")}
            description={t("admin.hostDefaultsSessionLoggingDesc")}
          >
            <AdminToggle
              on={defaults.enableSessionLogging ?? true}
              onToggle={() =>
                setDefaults((p) => ({
                  ...p,
                  enableSessionLogging: !(p.enableSessionLogging ?? true),
                }))
              }
            />
          </SettingRow>
          <SettingRow
            label={t("admin.hostDefaultsCommandHistory")}
            description={t("admin.hostDefaultsCommandHistoryDesc")}
          >
            <AdminToggle
              on={defaults.enableCommandHistory ?? true}
              onToggle={() =>
                setDefaults((p) => ({
                  ...p,
                  enableCommandHistory: !(p.enableCommandHistory ?? true),
                }))
              }
            />
          </SettingRow>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
          onClick={handleSaveDefaults}
        >
          {t("common.save")}
        </Button>
      </div>
    </AccordionSection>
  );
}

function certState(
  status: TlsStatus | null,
): "none" | "valid" | "expiring" | "expired" {
  const cert = status?.certificate;
  if (!cert) return "none";
  const left = new Date(cert.notAfter).getTime() - Date.now();
  if (left <= 0) return "expired";
  if (left < 30 * 86_400_000) return "expiring";
  return "valid";
}

const CERT_STATUS_STYLES: Record<ReturnType<typeof certState>, string> = {
  none: "text-muted-foreground",
  valid: "text-green-500",
  expiring: "text-yellow-500",
  expired: "text-destructive",
};

type AdminSSLSectionProps = {
  open: boolean;
  onToggle: () => void;
  status: TlsStatus | null;
  manualCertDraft: string;
  setManualCertDraft: Dispatch<SetStateAction<string>>;
  manualKeyDraft: string;
  setManualKeyDraft: Dispatch<SetStateAction<string>>;
  manualUploading: boolean;
  handleManualUpload: () => void;
};

export function AdminSSLSection({
  open,
  onToggle,
  status,
  manualCertDraft,
  setManualCertDraft,
  manualKeyDraft,
  setManualKeyDraft,
  manualUploading,
  handleManualUpload,
}: AdminSSLSectionProps) {
  const { t } = useTranslation();
  const cert = status?.certificate ?? null;
  const state = certState(status);
  const expiry = cert ? new Date(cert.notAfter).toLocaleDateString() : "";

  const certStatusLabel: Record<ReturnType<typeof certState>, string> = {
    none: t("admin.sslCertStatusNone"),
    valid: t("admin.sslCertStatusValid"),
    expiring: t("admin.sslCertStatusExpiring"),
    expired: t("admin.sslCertStatusExpired"),
  };

  return (
    <AccordionSection
      label={t("admin.sectionSsl")}
      icon={<Lock className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-3 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {t("admin.sslDescription")}{" "}
          <a
            href="https://docs.termix.site/features/networking/ssl"
            target="_blank"
            rel="noreferrer"
            className="text-accent-brand hover:underline"
          >
            {t("admin.sslDocsLink")}
          </a>
        </span>

        <div className="flex flex-col gap-0.5 p-2 border border-border bg-background/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("admin.sslCertStatus")}
            </span>
            <span
              className={`text-xs font-medium ${CERT_STATUS_STYLES[state]}`}
            >
              {certStatusLabel[state]}
            </span>
          </div>
          {cert && (
            <>
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sslNames", { names: cert.names.join(", ") || "-" })}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sslIssuer", { issuer: cert.issuer })}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sslCertExpiresAt", { date: expiry })}
              </span>
              {cert.selfSigned && (
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.sslSelfSigned")}
                </span>
              )}
              {status?.renewal && (
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.sslRenewedBy", {
                    plugin: status.renewal.pluginName,
                  })}
                </span>
              )}
            </>
          )}
        </div>

        {cert && !cert.selfSigned && !status?.renewal && (
          <div className="p-2 border border-yellow-500/40 bg-yellow-500/10 text-[10px] text-yellow-600 dark:text-yellow-400">
            {t("admin.sslNotRenewed", { date: expiry })}
          </div>
        )}

        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest border-t border-border pt-2">
          {t("admin.sslManualTitle")}
        </span>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.sslManualCert")}
          </label>
          <textarea
            rows={5}
            value={manualCertDraft}
            onChange={(e) => setManualCertDraft(e.target.value)}
            placeholder={t("admin.sslManualCertPlaceholder")}
            spellCheck={false}
            className="w-full px-2 py-1.5 text-[10px] font-mono bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.sslManualKey")}
          </label>
          <textarea
            rows={5}
            value={manualKeyDraft}
            onChange={(e) => setManualKeyDraft(e.target.value)}
            placeholder={t("admin.sslManualKeyPlaceholder")}
            spellCheck={false}
            className="w-full px-2 py-1.5 text-[10px] font-mono bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] text-muted-foreground">
            {t("admin.sslManualDesc")}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
          onClick={handleManualUpload}
          disabled={manualUploading}
        >
          <RefreshCw
            className={`size-3 ${manualUploading ? "animate-spin" : ""}`}
          />
          {manualUploading
            ? t("admin.sslManualUploadLoading")
            : t("admin.sslManualUpload")}
        </Button>

        <span className="text-[10px] text-muted-foreground border-t border-border pt-2">
          {t("admin.sslInfoNote")}
        </span>
      </div>
    </AccordionSection>
  );
}
