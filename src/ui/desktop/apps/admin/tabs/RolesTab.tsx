import React from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Shield, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  type Role,
} from "@/ui/main-axios.ts";

export function RolesTab(): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [roles, setRoles] = React.useState<Role[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Create/Edit Role Dialog
  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<Role | null>(null);
  const [roleName, setRoleName] = React.useState("");
  const [roleDisplayName, setRoleDisplayName] = React.useState("");
  const [roleDescription, setRoleDescription] = React.useState("");

  // Load roles
  const loadRoles = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await getRoles();
      setRoles(response.roles || []);
    } catch (error) {
      toast.error(t("rbac.failedToLoadRoles"));
      console.error("Failed to load roles:", error);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  // Create role
  const handleCreateRole = () => {
    setEditingRole(null);
    setRoleName("");
    setRoleDisplayName("");
    setRoleDescription("");
    setRoleDialogOpen(true);
  };

  // Edit role
  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDisplayName(role.displayName);
    setRoleDescription(role.description || "");
    setRoleDialogOpen(true);
  };

  // Save role
  const handleSaveRole = async () => {
    if (!roleDisplayName.trim()) {
      toast.error(t("rbac.roleDisplayNameRequired"));
      return;
    }

    if (!editingRole && !roleName.trim()) {
      toast.error(t("rbac.roleNameRequired"));
      return;
    }

    try {
      if (editingRole) {
        // Update existing role
        await updateRole(editingRole.id, {
          displayName: roleDisplayName,
          description: roleDescription || null,
        });
        toast.success(t("rbac.roleUpdatedSuccessfully"));
      } else {
        // Create new role
        await createRole({
          name: roleName,
          displayName: roleDisplayName,
          description: roleDescription || null,
        });
        toast.success(t("rbac.roleCreatedSuccessfully"));
      }

      setRoleDialogOpen(false);
      loadRoles();
    } catch (error) {
      toast.error(t("rbac.failedToSaveRole"));
    }
  };

  // Delete role
  const handleDeleteRole = async (role: Role) => {
    const confirmed = await confirmWithToast({
      title: t("rbac.confirmDeleteRole"),
      description: t("rbac.confirmDeleteRoleDescription", {
        name: role.displayName,
      }),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
    });

    if (!confirmed) return;

    try {
      await deleteRole(role.id);
      toast.success(t("rbac.roleDeletedSuccessfully"));
      loadRoles();
    } catch (error) {
      toast.error(t("rbac.failedToDeleteRole"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Roles Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("rbac.roleManagement")}
          </h3>
          <Button onClick={handleCreateRole}>
            <Plus className="h-4 w-4 mr-2" />
            {t("rbac.createRole")}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rbac.roleName")}</TableHead>
              <TableHead>{t("rbac.displayName")}</TableHead>
              <TableHead>{t("rbac.description")}</TableHead>
              <TableHead>{t("rbac.type")}</TableHead>
              <TableHead className="text-right">
                {t("common.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            ) : roles.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  {t("rbac.noRoles")}
                </TableCell>
              </TableRow>
            ) : (
              roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-mono">{role.name}</TableCell>
                  <TableCell>{t(role.displayName)}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {role.description || "-"}
                  </TableCell>
                  <TableCell>
                    {role.isSystem ? (
                      <Badge variant="secondary">{t("rbac.systemRole")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("rbac.customRole")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {!role.isSystem && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditRole(role)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteRole(role)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
          <DialogHeader>
            <DialogTitle>
              {editingRole ? t("rbac.editRole") : t("rbac.createRole")}
            </DialogTitle>
            <DialogDescription>
              {editingRole
                ? t("rbac.editRoleDescription")
                : t("rbac.createRoleDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {!editingRole && (
              <div className="space-y-2">
                <Label htmlFor="role-name">{t("rbac.roleName")}</Label>
                <Input
                  id="role-name"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value.toLowerCase())}
                  placeholder="developer"
                  disabled={!!editingRole}
                />
                <p className="text-xs text-muted-foreground">
                  {t("rbac.roleNameHint")}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="role-display-name">{t("rbac.displayName")}</Label>
              <Input
                id="role-display-name"
                value={roleDisplayName}
                onChange={(e) => setRoleDisplayName(e.target.value)}
                placeholder={t("rbac.displayNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role-description">{t("rbac.description")}</Label>
              <Textarea
                id="role-description"
                value={roleDescription}
                onChange={(e) => setRoleDescription(e.target.value)}
                placeholder={t("rbac.descriptionPlaceholder")}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSaveRole}>
              {editingRole ? t("common.save") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
