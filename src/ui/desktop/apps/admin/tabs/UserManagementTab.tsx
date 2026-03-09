import React from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { UserPlus, Edit, Trash2, Link2, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { deleteUser } from "@/ui/main-axios.ts";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
  is_oidc: boolean;
  password_hash?: string;
}

interface UserManagementTabProps {
  users: User[];
  usersLoading: boolean;
  allowPasswordLogin: boolean;
  fetchUsers: () => void;
  onCreateUser: () => void;
  onEditUser: (user: User) => void;
  onLinkOIDCUser: (user: { id: string; username: string }) => void;
  onUnlinkOIDC: (userId: string, username: string) => void;
}

export function UserManagementTab({
  users,
  usersLoading,
  allowPasswordLogin,
  fetchUsers,
  onCreateUser,
  onEditUser,
  onLinkOIDCUser,
  onUnlinkOIDC,
}: UserManagementTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const getAuthTypeDisplay = (user: User): string => {
    if (user.is_oidc && user.password_hash) {
      return t("admin.dualAuth");
    } else if (user.is_oidc) {
      return t("admin.externalOIDC");
    } else {
      return t("admin.localPassword");
    }
  };

  const handleDeleteUserQuick = async (username: string) => {
    confirmWithToast(
      t("admin.deleteUser", { username }),
      async () => {
        try {
          await deleteUser(username);
          toast.success(t("admin.userDeletedSuccessfully", { username }));
          fetchUsers();
        } catch {
          toast.error(t("admin.failedToDeleteUser"));
        }
      },
      "destructive",
    );
  };

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("admin.userManagement")}</h3>
        <div className="flex gap-2">
          {allowPasswordLogin && (
            <Button onClick={onCreateUser} size="sm">
              <UserPlus className="h-4 w-4 mr-2" />
              {t("admin.createUser")}
            </Button>
          )}
          <Button
            onClick={fetchUsers}
            disabled={usersLoading}
            variant="outline"
            size="sm"
          >
            {usersLoading ? t("admin.loading") : t("admin.refresh")}
          </Button>
        </div>
      </div>
      {usersLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("admin.loadingUsers")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.username")}</TableHead>
              <TableHead>{t("admin.authType")}</TableHead>
              <TableHead>{t("admin.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.username}
                  {user.is_admin && (
                    <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
                      {t("admin.adminBadge")}
                    </span>
                  )}
                </TableCell>
                <TableCell>{getAuthTypeDisplay(user)}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditUser(user)}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      title={t("admin.manageUser")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {user.is_oidc && !user.password_hash && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onLinkOIDCUser({
                            id: user.id,
                            username: user.username,
                          })
                        }
                        className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                        title="Link to password account"
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                    )}
                    {user.is_oidc && user.password_hash && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onUnlinkOIDC(user.id, user.username)}
                        className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                        title="Unlink OIDC (keep password only)"
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteUserQuick(user.username)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      disabled={user.is_admin}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
