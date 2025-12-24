import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import {
  UserCog,
  Trash2,
  Plus,
  AlertCircle,
  Shield,
  Key,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getUserRoles,
  getRoles,
  assignRoleToUser,
  removeRoleFromUser,
  makeUserAdmin,
  removeAdminStatus,
  initiatePasswordReset,
  revokeAllUserSessions,
  deleteUser,
  type UserRole,
  type Role,
} from "@/ui/main-axios.ts";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
  is_oidc: boolean;
  password_hash?: string;
}

interface UserEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  currentUser: { id: string; username: string } | null;
  onSuccess: () => void;
  allowPasswordLogin: boolean;
}

export function UserEditDialog({
  open,
  onOpenChange,
  user,
  currentUser,
  onSuccess,
  allowPasswordLogin,
}: UserEditDialogProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [adminLoading, setAdminLoading] = useState(false);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const isCurrentUser = user?.id === currentUser?.id;

  useEffect(() => {
    if (open && user) {
      setIsAdmin(user.is_admin);
      loadRoles();
    }
  }, [open, user]);

  const loadRoles = async () => {
    if (!user) return;

    setRolesLoading(true);
    try {
      const [rolesResponse, allRolesResponse] = await Promise.all([
        getUserRoles(user.id),
        getRoles(),
      ]);

      setUserRoles(rolesResponse.roles || []);
      setAvailableRoles(allRolesResponse.roles || []);
    } catch (error) {
      console.error("Failed to load roles:", error);
      toast.error(t("rbac.failedToLoadRoles"));
    } finally {
      setRolesLoading(false);
    }
  };

  const handleToggleAdmin = async (checked: boolean) => {
    if (!user) return;

    if (isCurrentUser) {
      toast.error(t("admin.cannotRemoveOwnAdmin"));
      return;
    }

    // Close dialog temporarily to show confirmation toast on top
    const userToUpdate = user;
    onOpenChange(false);

    const confirmed = await confirmWithToast({
      title: checked ? t("admin.makeUserAdmin") : t("admin.removeAdmin"),
      description: checked
        ? t("admin.confirmMakeAdmin", { username: userToUpdate.username })
        : t("admin.confirmRemoveAdmin", { username: userToUpdate.username }),
      confirmText: checked ? t("admin.makeAdmin") : t("admin.removeAdmin"),
      cancelText: t("common.cancel"),
      variant: checked ? "default" : "destructive",
    });

    if (!confirmed) {
      onOpenChange(true);
      return;
    }

    setAdminLoading(true);
    try {
      if (checked) {
        await makeUserAdmin(userToUpdate.username);
        toast.success(
          t("admin.userIsNowAdmin", { username: userToUpdate.username }),
        );
      } else {
        await removeAdminStatus(userToUpdate.username);
        toast.success(
          t("admin.adminStatusRemoved", { username: userToUpdate.username }),
        );
      }
      setIsAdmin(checked);
      onSuccess();
      onOpenChange(true);
    } catch (error) {
      console.error("Failed to toggle admin status:", error);
      toast.error(
        checked
          ? t("admin.failedToMakeUserAdmin")
          : t("admin.failedToRemoveAdminStatus"),
      );
      onOpenChange(true);
    } finally {
      setAdminLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user) return;

    // Close dialog temporarily to show confirmation toast on top
    const userToReset = user;
    onOpenChange(false);

    const confirmed = await confirmWithToast({
      title: t("admin.resetUserPassword"),
      description: `${t("admin.passwordResetWarning")} (${userToReset.username})`,
      confirmText: t("admin.resetUserPassword"),
      cancelText: t("common.cancel"),
      variant: "destructive",
    });

    if (!confirmed) {
      onOpenChange(true);
      return;
    }

    setPasswordResetLoading(true);
    try {
      await initiatePasswordReset(userToReset.username);
      toast.success(
        t("admin.passwordResetInitiated", { username: userToReset.username }),
      );
      onSuccess();
      onOpenChange(true);
    } catch (error) {
      console.error("Failed to reset password:", error);
      toast.error(t("admin.failedToResetPassword"));
      onOpenChange(true);
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const handleAssignRole = async (roleId: number) => {
    if (!user) return;

    try {
      await assignRoleToUser(user.id, roleId);
      toast.success(
        t("rbac.roleAssignedSuccessfully", { username: user.username }),
      );
      await loadRoles();
    } catch (error) {
      console.error("Failed to assign role:", error);
      toast.error(t("rbac.failedToAssignRole"));
    }
  };

  const handleRemoveRole = async (roleId: number) => {
    if (!user) return;

    // Close dialog temporarily to show confirmation toast on top
    const userToUpdate = user;
    onOpenChange(false);

    const confirmed = await confirmWithToast({
      title: t("rbac.confirmRemoveRole"),
      description: t("rbac.confirmRemoveRoleDescription"),
      confirmText: t("common.remove"),
      cancelText: t("common.cancel"),
      variant: "destructive",
    });

    if (!confirmed) {
      onOpenChange(true);
      return;
    }

    try {
      await removeRoleFromUser(userToUpdate.id, roleId);
      toast.success(
        t("rbac.roleRemovedSuccessfully", { username: userToUpdate.username }),
      );
      await loadRoles();
      onOpenChange(true);
    } catch (error) {
      console.error("Failed to remove role:", error);
      toast.error(t("rbac.failedToRemoveRole"));
      onOpenChange(true);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!user) return;

    const isRevokingSelf = isCurrentUser;

    // Close dialog temporarily to show confirmation toast on top
    const userToUpdate = user;
    onOpenChange(false);

    const confirmed = await confirmWithToast({
      title: t("admin.revokeAllSessions"),
      description: isRevokingSelf
        ? t("admin.confirmRevokeOwnSessions")
        : t("admin.confirmRevokeAllSessions"),
      confirmText: t("admin.revoke"),
      cancelText: t("common.cancel"),
      variant: "destructive",
    });

    if (!confirmed) {
      onOpenChange(true);
      return;
    }

    setSessionLoading(true);
    try {
      const data = await revokeAllUserSessions(userToUpdate.id);
      toast.success(data.message || t("admin.sessionsRevokedSuccessfully"));

      if (isRevokingSelf) {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        onSuccess();
        onOpenChange(true);
      }
    } catch (error) {
      console.error("Failed to revoke sessions:", error);
      toast.error(t("admin.failedToRevokeSessions"));
      onOpenChange(true);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!user) return;

    if (isCurrentUser) {
      toast.error(t("admin.cannotDeleteSelf"));
      return;
    }

    // Close dialog temporarily to show confirmation toast on top
    const userToDelete = user;
    onOpenChange(false);

    const confirmed = await confirmWithToast({
      title: t("admin.deleteUserTitle"),
      description: t("admin.deleteUser", { username: userToDelete.username }),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
      variant: "destructive",
    });

    if (!confirmed) {
      // Reopen dialog if user cancels
      onOpenChange(true);
      return;
    }

    setDeleteLoading(true);
    try {
      await deleteUser(userToDelete.username);
      toast.success(
        t("admin.userDeletedSuccessfully", { username: userToDelete.username }),
      );
      onSuccess();
    } catch (error) {
      console.error("Failed to delete user:", error);
      toast.error(t("admin.failedToDeleteUser"));
      onOpenChange(true);
    } finally {
      setDeleteLoading(false);
    }
  };

  const getAuthTypeDisplay = (): string => {
    if (!user) return "";
    if (user.is_oidc && user.password_hash) {
      return t("admin.dualAuth");
    } else if (user.is_oidc) {
      return t("admin.externalOIDC");
    } else {
      return t("admin.localPassword");
    }
  };

  if (!user) return null;

  const showPasswordReset =
    allowPasswordLogin && (user.password_hash || !user.is_oidc);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-canvas border-2 border-edge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5" />
            {t("admin.manageUser")}: {user.username}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("admin.manageUserDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 max-h-[70vh] overflow-y-auto thin-scrollbar pr-2">
          {/* READ-ONLY INFO SECTION */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-surface rounded-lg border border-edge">
            <div>
              <Label className="text-muted-foreground text-xs">
                {t("admin.username")}
              </Label>
              <p className="font-medium">{user.username}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">
                {t("admin.authType")}
              </Label>
              <p className="font-medium">{getAuthTypeDisplay()}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">
                {t("admin.adminStatus")}
              </Label>
              <p className="font-medium">
                {isAdmin ? (
                  <Badge variant="secondary">{t("admin.adminBadge")}</Badge>
                ) : (
                  t("admin.regularUser")
                )}
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">
                {t("admin.userId")}
              </Label>
              <p className="font-mono text-xs truncate">{user.id}</p>
            </div>
          </div>

          <Separator />

          {/* ADMIN TOGGLE SECTION */}
          <div className="space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t("admin.adminPrivileges")}
            </Label>
            <div className="flex items-center justify-between p-3 border border-edge rounded-lg bg-surface">
              <div className="flex-1">
                <p className="font-medium">{t("admin.administratorRole")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.administratorRoleDescription")}
                </p>
              </div>
              <Switch
                checked={isAdmin}
                onCheckedChange={handleToggleAdmin}
                disabled={isCurrentUser || adminLoading}
              />
            </div>
            {isCurrentUser && (
              <p className="text-xs text-muted-foreground">
                {t("admin.cannotModifyOwnAdminStatus")}
              </p>
            )}
          </div>

          <Separator />

          {/* PASSWORD RESET SECTION */}
          {showPasswordReset && (
            <>
              <div className="space-y-3">
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  {t("admin.passwordManagement")}
                </Label>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("common.warning")}</AlertTitle>
                  <AlertDescription>
                    {t("admin.passwordResetWarning")}
                  </AlertDescription>
                </Alert>
                <Button
                  variant="destructive"
                  onClick={handlePasswordReset}
                  disabled={passwordResetLoading}
                  className="w-full"
                >
                  {passwordResetLoading
                    ? t("admin.resettingPassword")
                    : t("admin.resetUserPassword")}
                </Button>
              </div>
              <Separator />
            </>
          )}

          {/* ROLE MANAGEMENT SECTION */}
          <div className="space-y-4">
            <Label className="text-base font-semibold flex items-center gap-2">
              <UserCog className="h-4 w-4" />
              {t("rbac.roleManagement")}
            </Label>

            {rolesLoading ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                {t("common.loading")}
              </div>
            ) : (
              <>
                {/* Current Roles */}
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    {t("rbac.currentRoles")}
                  </Label>
                  {userRoles.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-2">
                      {t("rbac.noRolesAssigned")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {userRoles.map((role) => (
                        <div
                          key={role.roleId}
                          className="flex items-center justify-between p-3 border border-edge rounded-lg bg-surface"
                        >
                          <div>
                            <p className="font-medium text-sm">
                              {t(role.roleDisplayName)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {role.roleName}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {role.isSystem && (
                              <Badge variant="secondary" className="text-xs">
                                {t("rbac.systemRole")}
                              </Badge>
                            )}
                            {!role.isSystem && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveRole(role.roleId)}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assign New Role */}
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    {t("rbac.assignNewRole")}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {availableRoles
                      .filter(
                        (role) =>
                          !role.isSystem &&
                          !userRoles.some((ur) => ur.roleId === role.id),
                      )
                      .map((role) => (
                        <Button
                          key={role.id}
                          variant="outline"
                          size="sm"
                          onClick={() => handleAssignRole(role.id)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          {t(role.displayName)}
                        </Button>
                      ))}
                    {availableRoles.filter(
                      (role) =>
                        !role.isSystem &&
                        !userRoles.some((ur) => ur.roleId === role.id),
                    ).length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        {t("rbac.noCustomRolesToAssign")}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* SESSION MANAGEMENT SECTION */}
          <div className="space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t("admin.sessionManagement")}
            </Label>
            <div className="flex items-center justify-between p-3 border border-edge rounded-lg bg-surface">
              <div className="flex-1">
                <p className="font-medium text-sm">
                  {t("admin.revokeAllSessions")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.revokeAllSessionsDescription")}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRevokeAllSessions}
                disabled={sessionLoading}
              >
                {sessionLoading ? t("admin.revoking") : t("admin.revoke")}
              </Button>
            </div>
          </div>

          <Separator />

          {/* DANGER ZONE - DELETE USER */}
          <div className="space-y-3">
            <Label className="text-base font-semibold text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t("admin.dangerZone")}
            </Label>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("admin.deleteUserTitle")}</AlertTitle>
              <AlertDescription>
                {t("admin.deleteUserWarning")}
              </AlertDescription>
            </Alert>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={isCurrentUser || deleteLoading}
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteLoading
                ? t("admin.deleting")
                : `${t("common.delete")} ${user.username}`}
            </Button>
            {isCurrentUser && (
              <p className="text-xs text-muted-foreground text-center">
                {t("admin.cannotDeleteSelf")}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
