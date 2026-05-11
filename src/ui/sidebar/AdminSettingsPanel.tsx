import { useState, useEffect } from "react";
import {
  getUserList,
  getSessions,
  getRoles,
  getApiKeys,
  deleteUser,
  revokeSession,
  deleteRole,
  deleteApiKey,
} from "@/main-axios";
import type { ApiKey } from "@/main-axios";
import type React from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  Database,
  Eye,
  KeyRound,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shield,
  Trash2,
  User,
  X,
} from "lucide-react";
import { SettingRow } from "@/components/section-card";
import type { AdminSection } from "@/types/ui-types";
import type { Role } from "@/main-axios";

function AdminToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${on ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
    >
      <span
        className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function AccordionSection({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="text-xs font-bold uppercase tracking-widest text-foreground flex-1">
          {label}
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-3">{children}</div>
      )}
    </div>
  );
}

export function AdminSettingsPanel() {
  const [openSection, setOpenSection] = useState<AdminSection | null>(
    "general",
  );
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [allowPasswordLogin, setAllowPasswordLogin] = useState(true);
  const [allowPasswordReset, setAllowPasswordReset] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("24");
  const [statusInterval, setStatusInterval] = useState("60");
  const [metricsInterval, setMetricsInterval] = useState("30");
  const [guacEnabled, setGuacEnabled] = useState(false);
  const [guacUrl, setGuacUrl] = useState("guacd:4822");
  const [logLevel, setLogLevel] = useState("info");
  const [importFile, setImportFile] = useState<string | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState<any | null>(null);
  const [linkAccountOpen, setLinkAccountOpen] = useState(false);
  const [linkAccountTarget, setLinkAccountTarget] = useState<{
    id: string;
    username: string;
  } | null>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  useEffect(() => {
    getUserList()
      .then(({ users: u }) => setUsers(u))
      .catch(() => {});
    getSessions()
      .then(({ sessions: s }) => setSessions(s))
      .catch(() => {});
    getRoles()
      .then(({ roles: r }) => setRoles(r))
      .catch(() => {});
    getApiKeys()
      .then(({ apiKeys: k }) => setApiKeys(k))
      .catch(() => {});
  }, []);

  function toggle(id: AdminSection) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* General */}
      <AccordionSection
        label="General"
        icon={<Settings className="size-3.5" />}
        open={openSection === "general"}
        onToggle={() => toggle("general")}
      >
        <div className="flex flex-col gap-0 pt-2">
          <SettingRow
            label="Allow User Registration"
            description="Let new users self-register"
          >
            <AdminToggle
              on={allowRegistration}
              onToggle={() => setAllowRegistration((o) => !o)}
            />
          </SettingRow>
          <SettingRow
            label="Allow Password Login"
            description="Username/password login"
          >
            <AdminToggle
              on={allowPasswordLogin}
              onToggle={() => setAllowPasswordLogin((o) => !o)}
            />
          </SettingRow>
          <SettingRow
            label="Allow Password Reset"
            description="Email-based password reset"
          >
            <AdminToggle
              on={allowPasswordReset}
              onToggle={() => setAllowPasswordReset((o) => !o)}
            />
          </SettingRow>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Session Timeout
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
              <span className="text-xs text-muted-foreground">hours</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              Min 1h · Max 720h
            </span>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Monitoring Defaults
            </span>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Status Check
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={statusInterval}
                  onChange={(e) => setStatusInterval(e.target.value)}
                  className="w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Metrics
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={metricsInterval}
                  onChange={(e) => setMetricsInterval(e.target.value)}
                  className="w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <SettingRow
              label="Enable Guacamole"
              description="RDP/VNC remote desktop"
            >
              <AdminToggle
                on={guacEnabled}
                onToggle={() => setGuacEnabled((o) => !o)}
              />
            </SettingRow>
            {guacEnabled && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  guacd URL
                </label>
                <Input
                  value={guacUrl}
                  onChange={(e) => setGuacUrl(e.target.value)}
                  placeholder="guacd:4822"
                  className="text-sm"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Log Level
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {["debug", "info", "warn", "error"].map((l) => (
                <button
                  key={l}
                  onClick={() => setLogLevel(l)}
                  className={`px-2 py-1 text-[10px] font-semibold border capitalize transition-colors ${logLevel === l ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* OIDC */}
      <AccordionSection
        label="OIDC"
        icon={<Shield className="size-3.5" />}
        open={openSection === "oidc"}
        onToggle={() => toggle("oidc")}
      >
        <div className="flex flex-col gap-3 pt-3">
          <span className="text-[10px] text-muted-foreground">
            Configure OpenID Connect for SSO. Fields marked{" "}
            <span className="text-accent-brand">*</span> are required.
          </span>
          {(
            [
              {
                label: "Client ID",
                placeholder: "your-client-id",
                required: true,
              },
              {
                label: "Client Secret",
                placeholder: "your-client-secret",
                type: "password",
                required: true,
              },
              {
                label: "Authorization URL",
                placeholder: "https://provider/oauth2/auth",
                required: true,
              },
              {
                label: "Issuer URL",
                placeholder: "https://provider",
                required: true,
              },
              {
                label: "Token URL",
                placeholder: "https://provider/oauth2/token",
                required: true,
              },
              {
                label: "User Identifier Path",
                placeholder: "sub",
                required: true,
              },
              {
                label: "Display Name Path",
                placeholder: "name",
                required: true,
              },
              {
                label: "Scopes",
                placeholder: "openid email profile",
                required: true,
              },
              {
                label: "Override Userinfo URL",
                placeholder: "https://provider/oauth2/userinfo",
              },
            ] as {
              label: string;
              placeholder: string;
              type?: string;
              required?: boolean;
            }[]
          ).map((f) => (
            <div key={f.label} className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {f.label}
                {f.required && (
                  <span className="text-accent-brand ml-0.5">*</span>
                )}
              </label>
              <Input
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                className="text-xs"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Allowed Users
            </label>
            <span className="text-[10px] text-muted-foreground">
              One email per line. Leave empty to allow all.
            </span>
            <textarea
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
            >
              <Trash2 className="size-3" />
              Remove
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            >
              <RefreshCw className="size-3" />
              Save
            </Button>
          </div>
        </div>
      </AccordionSection>

      {/* Users */}
      <AccordionSection
        label="Users"
        icon={<User className="size-3.5" />}
        open={openSection === "users"}
        onToggle={() => toggle("users")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {users.length} users
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={() => setCreateUserOpen(true)}
              >
                <Plus className="size-3" />
                Create
              </Button>
            </div>
          </div>
          {users.map((user) => {
            const authLabel =
              user.isOidc && user.passwordHash
                ? "Dual"
                : user.isOidc
                  ? "OIDC"
                  : "Local";
            return (
              <div
                key={user.id}
                className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-6 bg-muted border border-border flex items-center justify-center text-[10px] font-bold shrink-0">
                    {user.username[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-semibold truncate max-w-[120px]">
                      {user.username}
                    </span>
                    <div className="flex items-center gap-1">
                      {user.isAdmin && (
                        <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                          ADMIN
                        </span>
                      )}
                      <span className="text-[9px] font-semibold px-1 py-px border border-border text-muted-foreground">
                        {authLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditUserTarget(user);
                      setEditUserOpen(true);
                    }}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  {user.isOidc && !user.passwordHash && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setLinkAccountTarget({
                          id: user.id,
                          username: user.username,
                        });
                        setLinkAccountOpen(true);
                      }}
                    >
                      <Share2 className="size-3" />
                    </Button>
                  )}
                  {user.isOidc && user.passwordHash && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-accent-brand"
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    disabled={user.is_admin}
                    onClick={async () => {
                      try {
                        await deleteUser(user.userId);
                        setUsers((prev) =>
                          prev.filter((u) => u.userId !== user.userId),
                        );
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </AccordionSection>

      {/* Sessions */}
      <AccordionSection
        label="Sessions"
        icon={<Activity className="size-3.5" />}
        open={openSection === "sessions"}
        onToggle={() => toggle("sessions")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {sessions.length} active
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-3" />
            </Button>
          </div>
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-2"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold">
                    {session.username}
                  </span>
                  {session.isCurrentSession && (
                    <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                      YOU
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate">
                  {session.deviceInfo}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Active: {session.lastActiveAt}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Exp: {session.expiresAt}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] text-muted-foreground hover:text-destructive h-6 px-1.5"
                >
                  All
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    try {
                      await revokeSession(session.id);
                      setSessions((prev) =>
                        prev.filter((s) => s.id !== session.id),
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Roles */}
      <AccordionSection
        label="Roles"
        icon={<KeyRound className="size-3.5" />}
        open={openSection === "roles"}
        onToggle={() => toggle("roles")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {roles.length} roles
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => setShowCreateRole((o) => !o)}
            >
              <Plus className="size-3" />
              Create
            </Button>
          </div>
          {showCreateRole && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                New Role
              </span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Name <span className="text-accent-brand">*</span>
                </label>
                <Input placeholder="e.g., developer" className="text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Display Name <span className="text-accent-brand">*</span>
                </label>
                <Input placeholder="e.g., Developer" className="text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional"
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowCreateRole(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                >
                  Create
                </Button>
              </div>
            </div>
          )}
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold truncate">
                    {role.displayName}
                  </span>
                  {role.isSystem ? (
                    <span className="text-[9px] font-semibold px-1 py-px border border-border text-muted-foreground">
                      SYS
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                      CUSTOM
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {role.name}
                </span>
              </div>
              {!role.isSystem && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      await deleteRole(role.id);
                      setRoles((prev) => prev.filter((r) => r.id !== role.id));
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Database */}
      <AccordionSection
        label="Database"
        icon={<Database className="size-3.5" />}
        open={openSection === "database"}
        onToggle={() => toggle("database")}
      >
        <div className="flex flex-col gap-3 pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Export Database</span>
            <span className="text-[10px] text-muted-foreground">
              Download a backup of all hosts, credentials, and settings
            </span>
            <Button
              variant="outline"
              size="sm"
              className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand mt-1"
            >
              Export
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-xs font-medium">Import Database</span>
            <span className="text-[10px] text-muted-foreground">
              {importFile
                ? `Selected: ${importFile}`
                : "Restore from a .sqlite backup file"}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <div className="relative">
                <input
                  type="file"
                  accept=".sqlite,.db"
                  onChange={(e) =>
                    setImportFile(e.target.files?.[0]?.name ?? null)
                  }
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-events-none text-xs"
                >
                  {importFile ? "Change" : "Select File"}
                </Button>
              </div>
              {importFile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                >
                  Import
                </Button>
              )}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* API Keys */}
      <AccordionSection
        label="API Keys"
        icon={<Network className="size-3.5" />}
        open={openSection === "api-keys"}
        onToggle={() => toggle("api-keys")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {apiKeys.length} keys
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={() => setShowCreateKey((o) => !o)}
              >
                <Plus className="size-3" />
                Create
              </Button>
            </div>
          </div>
          {showCreateKey && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                New API Key
              </span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Name <span className="text-accent-brand">*</span>
                </label>
                <Input placeholder="e.g., CI Pipeline" className="text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Scoped User <span className="text-accent-brand">*</span>
                </label>
                <Input placeholder="Select a user" className="text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Expires At
                </label>
                <Input type="date" className="text-xs" />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowCreateKey(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                >
                  Create Key
                </Button>
              </div>
            </div>
          )}
          {apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-2"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold truncate">
                    {key.name}
                  </span>
                  {!key.isActive && (
                    <span className="text-[9px] font-semibold px-1 py-px border border-destructive/40 bg-destructive/10 text-destructive">
                      REVOKED
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  User: {key.username}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {key.tokenPrefix}…
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {key.createdAt.split("T")[0]} ·{" "}
                  {key.expiresAt ? key.expiresAt.split("T")[0] : "No expiry"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={async () => {
                  await deleteApiKey(key.id);
                  setApiKeys((prev) => prev.filter((k) => k.id !== key.id));
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Dialogs */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Create User</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Create a new local account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Username <span className="text-accent-brand">*</span>
              </label>
              <Input placeholder="Enter username" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Password <span className="text-accent-brand">*</span>
              </label>
              <div className="relative">
                <Input
                  type="password"
                  placeholder="Enter password"
                  className="pr-9"
                />
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <Eye className="size-4" />
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                Minimum 6 characters.
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setCreateUserOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            >
              Create User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Manage User: {editUserTarget?.username}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Edit roles, admin status, sessions, and account settings.
            </DialogDescription>
          </DialogHeader>
          {editUserTarget && (
            <div className="flex flex-col gap-0 mt-1 divide-y divide-border">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Username
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.username}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Auth Type
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isOidc && editUserTarget.passwordHash
                      ? "Dual Auth"
                      : editUserTarget.isOidc
                        ? "OIDC"
                        : "Local"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Admin Status
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isAdmin ? "Administrator" : "Regular User"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    User ID
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {editUserTarget.id}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Administrator</span>
                  <span className="text-xs text-muted-foreground">
                    Full access to all admin settings
                  </span>
                </div>
                <AdminToggle on={editUserTarget.isAdmin} onToggle={() => {}} />
              </div>
              <div className="flex flex-col gap-2 py-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Roles
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {roles
                    .filter((r) => !r.isSystem)
                    .map((role) => (
                      <div
                        key={role.id}
                        className="flex items-center gap-1 px-2 py-1 border border-border text-xs"
                      >
                        <span>{role.displayName}</span>
                        <button className="text-muted-foreground hover:text-destructive ml-1">
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  >
                    <Plus className="size-3" />
                    Add Role
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    Revoke All Sessions
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Force re-login on all devices
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-8"
                >
                  Revoke
                </Button>
              </div>
              <div className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-xs text-destructive">
                    Deleting this user is permanent.
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={editUserTarget.isAdmin}
                >
                  <Trash2 className="size-3.5" />
                  Delete {editUserTarget.username}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={linkAccountOpen} onOpenChange={setLinkAccountOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Link OIDC to Password Account
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Merge the OIDC account{" "}
              <span className="font-semibold text-foreground">
                {linkAccountTarget?.username}
              </span>{" "}
              with an existing local account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 text-xs text-destructive">
                <span>This will:</span>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>Delete the OIDC-only account</li>
                  <li>Add OIDC login to the target account</li>
                  <li>Allow both OIDC and password login</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Target Username <span className="text-accent-brand">*</span>
              </label>
              <Input placeholder="Enter the local account username to link to" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setLinkAccountOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Link Accounts
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
