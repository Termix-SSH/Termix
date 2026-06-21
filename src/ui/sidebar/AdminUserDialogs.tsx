import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  assignRoleToUser,
  linkOIDCToPasswordAccount,
  removeRoleFromUser,
  unlinkOIDCFromPasswordAccount,
} from "@/main-axios";
import type { Role, UserRole } from "@/main-axios";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { AlertCircle, Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminToggle } from "./AdminSettingsShared";
import type { AdminUser } from "./AdminManagementSections";

type ApiErrorLike = {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
};

function apiErrorMessage(error: unknown, fallback: string) {
  const err = error as ApiErrorLike;
  return err.response?.data?.error || err.message || fallback;
}

type CreateUserDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  newUsername: string;
  setNewUsername: Dispatch<SetStateAction<string>>;
  newPassword: string;
  setNewPassword: Dispatch<SetStateAction<string>>;
  showNewPassword: boolean;
  setShowNewPassword: Dispatch<SetStateAction<boolean>>;
  handleCreateUser: () => void;
  createUserLoading: boolean;
};

export function AdminCreateUserDialog({
  open,
  onOpenChange,
  newUsername,
  setNewUsername,
  newPassword,
  setNewPassword,
  showNewPassword,
  setShowNewPassword,
  handleCreateUser,
  createUserLoading,
}: CreateUserDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("admin.createUserTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("admin.createUserDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.createUserUsername")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              placeholder={t("admin.createUserEnterUsername")}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.createUserPassword")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <div className="relative">
              <Input
                type={showNewPassword ? "text" : "password"}
                placeholder="Enter password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                className="pr-9"
              />
              <button
                onClick={() => setShowNewPassword((o) => !o)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNewPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("admin.createUserPasswordHint")}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              setNewUsername("");
              setNewPassword("");
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleCreateUser}
            disabled={createUserLoading}
          >
            {createUserLoading
              ? t("admin.creating")
              : t("admin.createUserSubmit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type EditUserDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  editUserTarget: AdminUser | null;
  editUserLoading: boolean;
  editUserRoles: UserRole[];
  editUserRolesLoading: boolean;
  roles: Role[];
  setEditUserRoles: Dispatch<SetStateAction<UserRole[]>>;
  handleToggleAdmin: (user: AdminUser) => void;
  handleRevokeUserSessions: (userId: string) => void;
  handleDeleteEditUser: () => void;
};

export function AdminEditUserDialog({
  open,
  onOpenChange,
  editUserTarget,
  editUserLoading,
  editUserRoles,
  editUserRolesLoading,
  roles,
  setEditUserRoles,
  handleToggleAdmin,
  handleRevokeUserSessions,
  handleDeleteEditUser,
}: EditUserDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("admin.editUserTitle", { username: editUserTarget?.username })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("admin.editUserDesc")}
          </DialogDescription>
        </DialogHeader>
        {editUserTarget && (
          <div className="flex flex-col gap-0 mt-1 divide-y divide-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("admin.editUserUsername")}
                </span>
                <span className="text-sm font-semibold">
                  {editUserTarget.username}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("admin.editUserAuthType")}
                </span>
                <span className="text-sm font-semibold">
                  {editUserTarget.isOidc && editUserTarget.passwordHash
                    ? t("admin.authTypeDual")
                    : editUserTarget.isOidc
                      ? t("admin.authTypeOidc")
                      : t("admin.authTypeLocal")}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("admin.editUserAdminStatus")}
                </span>
                <span className="text-sm font-semibold">
                  {editUserTarget.isAdmin
                    ? t("admin.adminStatusAdministrator")
                    : t("admin.adminStatusRegularUser")}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("admin.editUserUserId")}
                </span>
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {editUserTarget.id}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t("admin.userAdminAccess")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("admin.userAdminAccessDesc")}
                </span>
              </div>
              <AdminToggle
                on={editUserTarget.isAdmin}
                onToggle={() => handleToggleAdmin(editUserTarget)}
              />
            </div>
            <div className="flex flex-col gap-2 py-3">
              <span className="text-sm font-medium">
                {t("admin.userRoles")}
              </span>
              {editUserRolesLoading ? (
                <span className="text-xs text-muted-foreground">
                  {t("newUi.sidebar.snippets.loading")}
                </span>
              ) : (
                <>
                  {editUserRoles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {editUserRoles.map((ur) => {
                        const roleInfo = roles.find((r) => r.id === ur.roleId);
                        const isSystem = roleInfo?.isSystem ?? false;
                        return (
                          <span
                            key={ur.roleId}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 border border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                          >
                            {ur.roleDisplayName}
                            {!isSystem && (
                              <button
                                onClick={async () => {
                                  try {
                                    await removeRoleFromUser(
                                      editUserTarget.id,
                                      ur.roleId,
                                    );
                                    setEditUserRoles((prev) =>
                                      prev.filter(
                                        (r) => r.roleId !== ur.roleId,
                                      ),
                                    );
                                  } catch {
                                    toast.error(t("admin.removeRoleFailed"));
                                  }
                                }}
                                className="hover:text-destructive ml-0.5"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {roles.filter(
                    (r) =>
                      !r.isSystem &&
                      !editUserRoles.some((ur) => ur.roleId === r.id),
                  ).length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                        {t("admin.addRole")}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {roles
                          .filter(
                            (r) =>
                              !r.isSystem &&
                              !editUserRoles.some((ur) => ur.roleId === r.id),
                          )
                          .map((r) => (
                            <button
                              key={r.id}
                              onClick={async () => {
                                try {
                                  await assignRoleToUser(
                                    editUserTarget.id,
                                    r.id,
                                  );
                                  setEditUserRoles((prev) => [
                                    ...prev,
                                    {
                                      userId: editUserTarget.id,
                                      roleId: r.id,
                                      roleName: r.name,
                                      roleDisplayName: r.displayName,
                                      grantedBy: "",
                                      grantedByUsername: "",
                                      grantedAt: new Date().toISOString(),
                                    },
                                  ]);
                                } catch {
                                  toast.error(t("admin.assignRoleFailed"));
                                }
                              }}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 border border-border text-muted-foreground hover:border-accent-brand/40 hover:text-accent-brand transition-colors"
                            >
                              + {r.displayName}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  {editUserRoles.length === 0 &&
                    roles.filter((r) => !r.isSystem).length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t("admin.noCustomRoles")}
                      </span>
                    )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t("admin.revokeAllUserSessions")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("admin.revokeAllUserSessionsDesc")}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-8"
                onClick={() => handleRevokeUserSessions(editUserTarget.id)}
                disabled={editUserLoading}
              >
                {t("admin.revoke")}
              </Button>
            </div>
            <div className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                <span className="text-xs text-destructive">
                  {t("admin.deleteUserWarning")}
                </span>
              </div>
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={editUserTarget.isAdmin || editUserLoading}
                onClick={handleDeleteEditUser}
              >
                <Trash2 className="size-3.5" />
                {editUserLoading
                  ? t("admin.deleting")
                  : t("admin.deleteUser", {
                      username: editUserTarget.username,
                    })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type UnlinkAccountDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  unlinkAccountTarget: { id: string; username: string } | null;
  onSuccess: (userId: string) => void;
};

export function AdminUnlinkAccountDialog({
  open,
  onOpenChange,
  unlinkAccountTarget,
  onSuccess,
}: UnlinkAccountDialogProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!unlinkAccountTarget) return;
    setSubmitting(true);
    try {
      await unlinkOIDCFromPasswordAccount(unlinkAccountTarget.id);
      toast.success(t("admin.unlinkAccountSuccess"));
      onSuccess(unlinkAccountTarget.id);
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, t("admin.unlinkAccountFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("admin.unlinkAccountTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("admin.unlinkAccountDesc", {
              username: unlinkAccountTarget?.username,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-xs text-destructive">
            {t("admin.unlinkAccountWarning")}
          </span>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={submitting || !unlinkAccountTarget}
            onClick={handleSubmit}
          >
            {submitting
              ? t("admin.unlinkAccountInProgress")
              : t("admin.unlinkAccount")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type LinkAccountDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  linkAccountTarget: { id: string; username: string; isOidc: boolean } | null;
  setUsers: Dispatch<SetStateAction<AdminUser[]>>;
  users: AdminUser[];
};

export function AdminLinkAccountDialog({
  open,
  onOpenChange,
  linkAccountTarget,
  setUsers,
  users,
}: LinkAccountDialogProps) {
  const { t } = useTranslation();
  const [otherUsername, setOtherUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setOtherUsername("");
  }, [open, linkAccountTarget]);

  const isOidcInitiator = linkAccountTarget?.isOidc ?? true;

  const handleSubmit = async () => {
    const trimmed = otherUsername.trim();
    if (!linkAccountTarget || !trimmed) return;

    setSubmitting(true);
    try {
      if (isOidcInitiator) {
        await linkOIDCToPasswordAccount(linkAccountTarget.id, trimmed);
        setUsers((prev) => prev.filter((u) => u.id !== linkAccountTarget.id));
      } else {
        const oidcUser = users.find(
          (u) => u.username === trimmed && u.isOidc && !u.passwordHash,
        );
        if (!oidcUser) {
          toast.error(t("admin.linkAccountOidcNotFound"));
          return;
        }
        await linkOIDCToPasswordAccount(
          oidcUser.id,
          linkAccountTarget.username,
        );
        setUsers((prev) => prev.filter((u) => u.id !== oidcUser.id));
      }
      toast.success(t("admin.linkAccountSuccess", { username: trimmed }));
      setOtherUsername("");
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, t("admin.linkAccountFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("admin.linkAccountTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isOidcInitiator
              ? t("admin.linkAccountDesc", {
                  username: linkAccountTarget?.username,
                })
              : t("admin.linkAccountDescLocal", {
                  username: linkAccountTarget?.username,
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 text-xs text-destructive">
              <span>{t("admin.linkAccountWarningTitle")}</span>
              <ul className="list-disc list-inside space-y-0.5 ml-1">
                <li>{t("admin.linkAccountEffect1")}</li>
                <li>{t("admin.linkAccountEffect2")}</li>
                <li>{t("admin.linkAccountEffect3")}</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {isOidcInitiator
                ? t("admin.linkAccountTargetUsername")
                : t("admin.linkAccountOidcUsername")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={otherUsername}
              onChange={(e) => setOtherUsername(e.target.value)}
              placeholder={
                isOidcInitiator
                  ? t("admin.linkAccountTargetPlaceholder")
                  : t("admin.linkAccountOidcPlaceholder")
              }
              autoFocus
              disabled={submitting}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={submitting || !linkAccountTarget || !otherUsername.trim()}
            onClick={handleSubmit}
          >
            {submitting
              ? t("admin.linkAccountInProgress")
              : t("admin.linkAccounts")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
