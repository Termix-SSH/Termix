import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteRole,
  deleteUser,
  revokeAllUserSessions,
  revokeSession,
} from "@/main-axios";
import type { Role } from "@/main-axios";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Activity,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Unlink,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { AccordionSection } from "./AdminSettingsShared";

export type AdminUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  isOidc: boolean;
  passwordHash?: string;
};

export type AdminSession = {
  id: string;
  userId: string;
  username?: string;
  deviceType: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
  isRevoked?: boolean;
  isCurrentSession?: boolean;
};

type ApiErrorLike = {
  response?: {
    data?: {
      error?: string;
    };
  };
};

function apiErrorMessage(error: unknown, fallback: string) {
  return (error as ApiErrorLike).response?.data?.error || fallback;
}

type UsersSectionProps = {
  open: boolean;
  onToggle: () => void;
  users: AdminUser[];
  setUsers: Dispatch<SetStateAction<AdminUser[]>>;
  loadUsers: () => void;
  setCreateUserOpen: Dispatch<SetStateAction<boolean>>;
  setEditUserTarget: Dispatch<SetStateAction<AdminUser | null>>;
  setEditUserOpen: Dispatch<SetStateAction<boolean>>;
  setLinkAccountTarget: Dispatch<
    SetStateAction<{ id: string; username: string; isOidc: boolean } | null>
  >;
  setLinkAccountOpen: Dispatch<SetStateAction<boolean>>;
  setUnlinkAccountTarget: Dispatch<
    SetStateAction<{ id: string; username: string } | null>
  >;
  setUnlinkAccountOpen: Dispatch<SetStateAction<boolean>>;
};

export function AdminUsersSection({
  open,
  onToggle,
  users,
  setUsers,
  loadUsers,
  setCreateUserOpen,
  setEditUserTarget,
  setEditUserOpen,
  setLinkAccountTarget,
  setLinkAccountOpen,
  setUnlinkAccountTarget,
  setUnlinkAccountOpen,
}: UsersSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionUsers")}
      icon={<User className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col pt-2">
        <div className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-[10px] text-muted-foreground">
            {t("admin.usersCount", { count: users.length })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={loadUsers}
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
              {t("admin.createUser")}
            </Button>
          </div>
        </div>
        {users.map((user) => {
          const authLabel =
            user.isOidc && user.passwordHash
              ? t("admin.authTypeDual")
              : user.isOidc
                ? t("admin.authTypeOidc")
                : t("admin.authTypeLocal");
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
                        {t("admin.adminBadge")}
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
                {user.isOidc && user.passwordHash ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title={t("admin.unlinkAccount")}
                    onClick={() => {
                      setUnlinkAccountTarget({
                        id: user.id,
                        username: user.username,
                      });
                      setUnlinkAccountOpen(true);
                    }}
                  >
                    <Unlink className="size-3" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title={t("admin.linkAccountTitle")}
                    onClick={() => {
                      setLinkAccountTarget({
                        id: user.id,
                        username: user.username,
                        isOidc: user.isOidc,
                      });
                      setLinkAccountOpen(true);
                    }}
                  >
                    <Share2 className="size-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  disabled={user.isAdmin}
                  onClick={async () => {
                    try {
                      await deleteUser(user.username);
                      setUsers((prev) => prev.filter((u) => u.id !== user.id));
                      toast.success(
                        t("admin.deleteUserSuccess", {
                          username: user.username,
                        }),
                      );
                    } catch (e: unknown) {
                      toast.error(
                        apiErrorMessage(e, t("admin.deleteUserFailed")),
                      );
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
  );
}

type SessionsSectionProps = {
  open: boolean;
  onToggle: () => void;
  sessions: AdminSession[];
  setSessions: Dispatch<SetStateAction<AdminSession[]>>;
  loadSessions: () => void;
};

export function AdminSessionsSection({
  open,
  onToggle,
  sessions,
  setSessions,
  loadSessions,
}: SessionsSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionSessions")}
      icon={<Activity className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col pt-2">
        <div className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-[10px] text-muted-foreground">
            {t("admin.sessionsActive", { count: sessions.length })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={loadSessions}
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
                    {t("admin.youBadge")}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground truncate">
                {session.deviceInfo}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sessionActive", { time: session.lastActiveAt })}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sessionExpires", { time: session.expiresAt })}
              </span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] text-muted-foreground hover:text-destructive h-6 px-1.5"
                onClick={async () => {
                  try {
                    await revokeAllUserSessions(session.userId);
                    setSessions((prev) =>
                      prev.filter((s) => s.userId !== session.userId),
                    );
                    toast.success(t("admin.revokeAllSessionsSuccess"));
                  } catch {
                    toast.error(t("admin.revokeAllSessionsFailed"));
                  }
                }}
              >
                {t("admin.revokeAll")}
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
                    toast.error(t("admin.revokeSessionFailed"));
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
  );
}

type RolesSectionProps = {
  open: boolean;
  onToggle: () => void;
  roles: Role[];
  setRoles: Dispatch<SetStateAction<Role[]>>;
  showCreateRole: boolean;
  setShowCreateRole: Dispatch<SetStateAction<boolean>>;
  newRoleName: string;
  setNewRoleName: Dispatch<SetStateAction<string>>;
  newRoleDisplayName: string;
  setNewRoleDisplayName: Dispatch<SetStateAction<string>>;
  newRoleDescription: string;
  setNewRoleDescription: Dispatch<SetStateAction<string>>;
  handleCreateRole: () => void;
  createRoleLoading: boolean;
};

export function AdminRolesSection({
  open,
  onToggle,
  roles,
  setRoles,
  showCreateRole,
  setShowCreateRole,
  newRoleName,
  setNewRoleName,
  newRoleDisplayName,
  setNewRoleDisplayName,
  newRoleDescription,
  setNewRoleDescription,
  handleCreateRole,
  createRoleLoading,
}: RolesSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionRoles")}
      icon={<KeyRound className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col pt-2">
        <div className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-[10px] text-muted-foreground">
            {t("admin.rolesCount", { count: roles.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={() => setShowCreateRole((o) => !o)}
          >
            <Plus className="size-3" />
            {t("admin.createRole")}
          </Button>
        </div>
        {showCreateRole && (
          <div className="flex flex-col gap-2.5 py-3 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.newRole")}
            </span>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("admin.roleName")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder="e.g., developer"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("admin.roleDisplayName")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder="e.g., Developer"
                value={newRoleDisplayName}
                onChange={(e) => setNewRoleDisplayName(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                {t("admin.roleDescription")}
              </label>
              <textarea
                rows={2}
                placeholder={t("common.optional")}
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setShowCreateRole(false);
                  setNewRoleName("");
                  setNewRoleDisplayName("");
                  setNewRoleDescription("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={handleCreateRole}
                disabled={createRoleLoading}
              >
                {createRoleLoading
                  ? t("admin.creating")
                  : t("admin.createRole")}
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
                    {t("admin.systemBadge")}
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                    {t("admin.customBadge")}
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
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await deleteRole(role.id);
                    setRoles((prev) => prev.filter((r) => r.id !== role.id));
                    toast.success(
                      t("admin.deleteRoleSuccess", {
                        name: role.displayName,
                      }),
                    );
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
  );
}
