import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { SettingRow } from "@/components/section-card";
import { Database, RefreshCw, Settings, Shield, Trash2 } from "lucide-react";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";

type GeneralSettingsSectionProps = {
  open: boolean;
  onToggle: () => void;
  allowRegistration: boolean;
  handleToggleRegistration: () => void;
  allowPasswordLogin: boolean;
  handleTogglePasswordLogin: () => void;
  oidcAutoProvision: boolean;
  handleToggleOidcAutoProvision: () => void;
  allowPasswordReset: boolean;
  handleTogglePasswordReset: () => void;
  sessionTimeout: string;
  setSessionTimeout: Dispatch<SetStateAction<string>>;
  handleSaveSessionTimeout: () => void;
  statusInterval: string;
  setStatusInterval: Dispatch<SetStateAction<string>>;
  metricsInterval: string;
  setMetricsInterval: Dispatch<SetStateAction<string>>;
  handleSaveMonitoring: () => void;
  guacEnabled: boolean;
  handleToggleGuacamole: () => void;
  guacUrl: string;
  setGuacUrl: Dispatch<SetStateAction<string>>;
  handleSaveGuacamole: () => void;
  logLevel: string;
  handleSaveLogLevel: (level: string) => void;
};

export function AdminGeneralSettingsSection({
  open,
  onToggle,
  allowRegistration,
  handleToggleRegistration,
  allowPasswordLogin,
  handleTogglePasswordLogin,
  oidcAutoProvision,
  handleToggleOidcAutoProvision,
  allowPasswordReset,
  handleTogglePasswordReset,
  sessionTimeout,
  setSessionTimeout,
  handleSaveSessionTimeout,
  statusInterval,
  setStatusInterval,
  metricsInterval,
  setMetricsInterval,
  handleSaveMonitoring,
  guacEnabled,
  handleToggleGuacamole,
  guacUrl,
  setGuacUrl,
  handleSaveGuacamole,
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
          label={t("admin.allowRegistration")}
          description={t("admin.allowRegistrationDesc")}
        >
          <AdminToggle
            on={allowRegistration}
            onToggle={handleToggleRegistration}
          />
        </SettingRow>
        <SettingRow
          label={t("admin.allowPasswordLogin")}
          description={t("admin.allowPasswordLoginDesc")}
        >
          <AdminToggle
            on={allowPasswordLogin}
            onToggle={handleTogglePasswordLogin}
          />
        </SettingRow>
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
          label={t("admin.allowPasswordReset")}
          description={t("admin.allowPasswordResetDesc")}
        >
          <AdminToggle
            on={allowPasswordReset}
            onToggle={handleTogglePasswordReset}
          />
        </SettingRow>

        <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
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
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("admin.metrics")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={metricsInterval}
                onChange={(e) => setMetricsInterval(e.target.value)}
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
          <SettingRow
            label={t("admin.enableGuacamole")}
            description={t("admin.enableGuacamoleDesc")}
          >
            <AdminToggle on={guacEnabled} onToggle={handleToggleGuacamole} />
          </SettingRow>
          {guacEnabled && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("admin.guacdUrl")}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={guacUrl}
                  onChange={(e) => setGuacUrl(e.target.value)}
                  placeholder="guacd:4822"
                  className="text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7 shrink-0"
                  onClick={handleSaveGuacamole}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
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

type OidcSettingsSectionProps = {
  open: boolean;
  onToggle: () => void;
  oidcClientId: string;
  setOidcClientId: Dispatch<SetStateAction<string>>;
  oidcClientSecret: string;
  setOidcClientSecret: Dispatch<SetStateAction<string>>;
  oidcAuthUrl: string;
  setOidcAuthUrl: Dispatch<SetStateAction<string>>;
  oidcIssuerUrl: string;
  setOidcIssuerUrl: Dispatch<SetStateAction<string>>;
  oidcTokenUrl: string;
  setOidcTokenUrl: Dispatch<SetStateAction<string>>;
  oidcUserIdentifier: string;
  setOidcUserIdentifier: Dispatch<SetStateAction<string>>;
  oidcDisplayName: string;
  setOidcDisplayName: Dispatch<SetStateAction<string>>;
  oidcScopes: string;
  setOidcScopes: Dispatch<SetStateAction<string>>;
  oidcUserinfoUrl: string;
  setOidcUserinfoUrl: Dispatch<SetStateAction<string>>;
  oidcAllowedUsers: string;
  setOidcAllowedUsers: Dispatch<SetStateAction<string>>;
  oidcSaving: boolean;
  handleRemoveOidc: () => void;
  handleSaveOidc: () => void;
};

export function AdminOidcSettingsSection({
  open,
  onToggle,
  oidcClientId,
  setOidcClientId,
  oidcClientSecret,
  setOidcClientSecret,
  oidcAuthUrl,
  setOidcAuthUrl,
  oidcIssuerUrl,
  setOidcIssuerUrl,
  oidcTokenUrl,
  setOidcTokenUrl,
  oidcUserIdentifier,
  setOidcUserIdentifier,
  oidcDisplayName,
  setOidcDisplayName,
  oidcScopes,
  setOidcScopes,
  oidcUserinfoUrl,
  setOidcUserinfoUrl,
  oidcAllowedUsers,
  setOidcAllowedUsers,
  oidcSaving,
  handleRemoveOidc,
  handleSaveOidc,
}: OidcSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionOidc")}
      icon={<Shield className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-3 pt-3">
        <span className="text-[10px] text-muted-foreground">
          {t("admin.oidcDescription").split("*")[0]}
          <span className="text-accent-brand">*</span>
          {t("admin.oidcDescription").split("*")[1]}
        </span>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcClientId")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcClientId}
            onChange={(e) => setOidcClientId(e.target.value)}
            placeholder="your-client-id"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcClientSecret")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            type="password"
            value={oidcClientSecret}
            onChange={(e) => setOidcClientSecret(e.target.value)}
            placeholder="your-client-secret"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcAuthUrl")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcAuthUrl}
            onChange={(e) => setOidcAuthUrl(e.target.value)}
            placeholder="https://provider/oauth2/auth"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcIssuerUrl")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcIssuerUrl}
            onChange={(e) => setOidcIssuerUrl(e.target.value)}
            placeholder="https://provider"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcTokenUrl")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcTokenUrl}
            onChange={(e) => setOidcTokenUrl(e.target.value)}
            placeholder="https://provider/oauth2/token"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcUserIdentifier")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcUserIdentifier}
            onChange={(e) => setOidcUserIdentifier(e.target.value)}
            placeholder="sub"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcDisplayName")}{" "}
            <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcDisplayName}
            onChange={(e) => setOidcDisplayName(e.target.value)}
            placeholder="name"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcScopes")} <span className="text-accent-brand">*</span>
          </label>
          <Input
            value={oidcScopes}
            onChange={(e) => setOidcScopes(e.target.value)}
            placeholder="openid email profile"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcUserinfoUrl")}
          </label>
          <Input
            value={oidcUserinfoUrl}
            onChange={(e) => setOidcUserinfoUrl(e.target.value)}
            placeholder="https://provider/oauth2/userinfo"
            className="text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.oidcAllowedUsers")}
          </label>
          <span className="text-[10px] text-muted-foreground">
            {t("admin.oidcAllowedUsersDesc")}
          </span>
          <textarea
            value={oidcAllowedUsers}
            onChange={(e) => setOidcAllowedUsers(e.target.value)}
            placeholder={"user@example.com\nanother@example.com"}
            rows={3}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleRemoveOidc}
          >
            <Trash2 className="size-3" />
            {t("admin.removeOidc")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleSaveOidc}
            disabled={oidcSaving}
          >
            <RefreshCw className="size-3" />
            {oidcSaving ? t("admin.saving") : t("common.save")}
          </Button>
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
