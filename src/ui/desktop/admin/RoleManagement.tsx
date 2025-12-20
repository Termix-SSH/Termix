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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Users,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getUserList,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  type Role,
  type UserRole,
} from "@/ui/main-axios.ts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
}

export function RoleManagement(): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [roles, setRoles] = React.useState<Role[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Create/Edit Role Dialog
  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<Role | null>(null);
  const [roleName, setRoleName] = React.useState("");
  const [roleDisplayName, setRoleDisplayName] = React.useState("");
  const [roleDescription, setRoleDescription] = React.useState("");

  // Assign Role Dialog
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false);
  const [selectedUserId, setSelectedUserId] = React.useState<string>("");
  const [selectedRoleId, setSelectedRoleId] = React.useState<number | null>(
    null,
  );
  const [userRoles, setUserRoles] = React.useState<UserRole[]>([]);

  // Combobox states
  const [userComboOpen, setUserComboOpen] = React.useState(false);
  const [roleComboOpen, setRoleComboOpen] = React.useState(false);

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

  // Load users
  const loadUsers = React.useCallback(async () => {
    try {
      const response = await getUserList();
      // Map UserInfo to User format
      const mappedUsers = (response.users || []).map((user) => ({
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
      }));
      setUsers(mappedUsers);
    } catch (error) {
      console.error("Failed to load users:", error);
      setUsers([]);
    }
  }, []);

  React.useEffect(() => {
    loadRoles();
    loadUsers();
  }, [loadRoles, loadUsers]);

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

  // Open assign dialog
  const handleOpenAssignDialog = async () => {
    setSelectedUserId("");
    setSelectedRoleId(null);
    setUserRoles([]);
    setAssignDialogOpen(true);
  };

  // Load user roles when user is selected
  const handleUserSelect = async (userId: string) => {
    setSelectedUserId(userId);
    setUserRoles([]);

    if (!userId) return;

    try {
      const response = await getUserRoles(userId);
      setUserRoles(response.roles || []);
    } catch (error) {
      console.error("Failed to load user roles:", error);
      setUserRoles([]);
    }
  };

  // Assign role to user
  const handleAssignRole = async () => {
    if (!selectedUserId || !selectedRoleId) {
      toast.error(t("rbac.selectUserAndRole"));
      return;
    }

    try {
      await assignRoleToUser(selectedUserId, selectedRoleId);
      const selectedUser = users.find((u) => u.id === selectedUserId);
      toast.success(
        t("rbac.roleAssignedSuccessfully", {
          username: selectedUser?.username || selectedUserId,
        }),
      );
      setSelectedRoleId(null);
      handleUserSelect(selectedUserId);
    } catch (error) {
      toast.error(t("rbac.failedToAssignRole"));
    }
  };

  // Remove role from user
  const handleRemoveUserRole = async (roleId: number) => {
    if (!selectedUserId) return;

    try {
      await removeRoleFromUser(selectedUserId, roleId);
      const selectedUser = users.find((u) => u.id === selectedUserId);
      toast.success(
        t("rbac.roleRemovedSuccessfully", {
          username: selectedUser?.username || selectedUserId,
        }),
      );
      handleUserSelect(selectedUserId);
    } catch (error) {
      toast.error(t("rbac.failedToRemoveRole"));
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

      {/* User-Role Assignment Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("rbac.userRoleAssignment")}
          </h3>
          <Button onClick={handleOpenAssignDialog}>
            <Users className="h-4 w-4 mr-2" />
            {t("rbac.assignRoles")}
          </Button>
        </div>
      </div>

      {/* Create/Edit Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="sm:max-w-[500px] bg-dark-bg border-2 border-dark-border">
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

      {/* Assign Role Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-2xl bg-dark-bg border-2 border-dark-border">
          <DialogHeader>
            <DialogTitle>{t("rbac.assignRoles")}</DialogTitle>
            <DialogDescription>
              {t("rbac.assignRolesDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* User Selection */}
            <div className="space-y-2">
              <Label htmlFor="user-select">{t("rbac.selectUser")}</Label>
              <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={userComboOpen}
                    className="w-full justify-between"
                  >
                    {selectedUserId
                      ? users.find((u) => u.id === selectedUserId)?.username +
                        (users.find((u) => u.id === selectedUserId)?.is_admin
                          ? " (Admin)"
                          : "")
                      : t("rbac.selectUserPlaceholder")}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0"
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                >
                  <Command>
                    <CommandInput placeholder={t("rbac.searchUsers")} />
                    <CommandEmpty>{t("rbac.noUserFound")}</CommandEmpty>
                    <CommandGroup className="max-h-[300px] overflow-y-auto">
                      {users.map((user) => (
                        <CommandItem
                          key={user.id}
                          value={`${user.username} ${user.id}`}
                          onSelect={() => {
                            handleUserSelect(user.id);
                            setUserComboOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedUserId === user.id
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {user.username}
                          {user.is_admin ? " (Admin)" : ""}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Current User Roles */}
            {selectedUserId && (
              <div className="space-y-2">
                <Label>{t("rbac.currentRoles")}</Label>
                {userRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("rbac.noRolesAssigned")}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
                    {userRoles.map((userRole, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div>
                          <p className="font-medium">
                            {t(userRole.roleDisplayName)}
                          </p>
                          {userRole.roleDisplayName && (
                            <p className="text-xs text-muted-foreground">
                              {userRole.roleName}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {userRole.isSystem ? (
                            <Badge variant="secondary" className="text-xs">
                              {t("rbac.systemRole")}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                handleRemoveUserRole(userRole.roleId)
                              }
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
            )}

            {/* Assign New Role */}
            {selectedUserId && (
              <div className="space-y-2">
                <Label htmlFor="role-select">{t("rbac.assignNewRole")}</Label>
                <div className="flex gap-2">
                  <Popover open={roleComboOpen} onOpenChange={setRoleComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={roleComboOpen}
                        className="flex-1 justify-between"
                      >
                        {selectedRoleId !== null
                          ? (() => {
                              const role = roles.find(
                                (r) => r.id === selectedRoleId,
                              );
                              return role
                                ? `${t(role.displayName)}${role.isSystem ? ` (${t("rbac.systemRole")})` : ""}`
                                : t("rbac.selectRolePlaceholder");
                            })()
                          : t("rbac.selectRolePlaceholder")}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-0"
                      style={{ width: "var(--radix-popover-trigger-width)" }}
                    >
                      <Command>
                        <CommandInput placeholder={t("rbac.searchRoles")} />
                        <CommandEmpty>{t("rbac.noRoleFound")}</CommandEmpty>
                        <CommandGroup className="max-h-[300px] overflow-y-auto">
                          {roles
                            .filter(
                              (role) =>
                                !role.isSystem &&
                                !userRoles.some((ur) => ur.roleId === role.id),
                            )
                            .map((role) => (
                              <CommandItem
                                key={role.id}
                                value={`${role.displayName} ${role.name} ${role.id}`}
                                onSelect={() => {
                                  setSelectedRoleId(role.id);
                                  setRoleComboOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedRoleId === role.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {t(role.displayName)}
                                {role.isSystem
                                  ? ` (${t("rbac.systemRole")})`
                                  : ""}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button onClick={handleAssignRole} disabled={!selectedRoleId}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("rbac.assign")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
            >
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
