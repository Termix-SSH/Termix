import React from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getRoles,
  getUserList,
  getUserInfo,
  shareHost,
  getHostAccess,
  revokeHostAccess,
  getSSHHostById,
  type Role,
  type AccessRecord,
} from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
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
import {
  Plus,
  Check,
  ChevronsUpDown,
  AlertCircle,
  Trash2,
  Users,
  Shield,
  Clock,
  UserCircle,
} from "lucide-react";
import type { SSHHost } from "@/types";
import type { HostSharingTabProps } from "./shared/tab-types";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
}

interface HostSharingTabProps {
  hostId: number | undefined;
  isNewHost: boolean;
}

export function HostSharingTab({
  hostId,
  isNewHost,
}: SharingTabContentProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [shareType, setShareType] = React.useState<"user" | "role">("user");
  const [selectedUserId, setSelectedUserId] = React.useState<string>("");
  const [selectedRoleId, setSelectedRoleId] = React.useState<number | null>(
    null,
  );
  const [permissionLevel, setPermissionLevel] = React.useState("view");
  const [expiresInHours, setExpiresInHours] = React.useState<string>("");

  const [roles, setRoles] = React.useState<Role[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [accessList, setAccessList] = React.useState<AccessRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState<string>("");
  const [hostData, setHostData] = React.useState<SSHHost | null>(null);

  const [userComboOpen, setUserComboOpen] = React.useState(false);
  const [roleComboOpen, setRoleComboOpen] = React.useState(false);

  const loadRoles = React.useCallback(async () => {
    try {
      const response = await getRoles();
      setRoles(response.roles || []);
    } catch (error) {
      console.error("Failed to load roles:", error);
      setRoles([]);
    }
  }, []);

  const loadUsers = React.useCallback(async () => {
    try {
      const response = await getUserList();
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

  const loadAccessList = React.useCallback(async () => {
    if (!hostId) return;

    setLoading(true);
    try {
      const response = await getHostAccess(hostId);
      setAccessList(response.accessList || []);
    } catch (error) {
      console.error("Failed to load access list:", error);
      setAccessList([]);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  const loadHostData = React.useCallback(async () => {
    if (!hostId) return;

    try {
      const host = await getSSHHostById(hostId);
      setHostData(host);
    } catch (error) {
      console.error("Failed to load host data:", error);
      setHostData(null);
    }
  }, [hostId]);

  React.useEffect(() => {
    loadRoles();
    loadUsers();
    if (!isNewHost) {
      loadAccessList();
      loadHostData();
    }
  }, [loadRoles, loadUsers, loadAccessList, loadHostData, isNewHost]);

  React.useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const userInfo = await getUserInfo();
        setCurrentUserId(userInfo.userId);
      } catch (error) {
        console.error("Failed to load current user:", error);
      }
    };
    fetchCurrentUser();
  }, []);

  const handleShare = async () => {
    if (!hostId) {
      toast.error(t("rbac.saveHostFirst"));
      return;
    }

    if (shareType === "user" && !selectedUserId) {
      toast.error(t("rbac.selectUser"));
      return;
    }

    if (shareType === "role" && !selectedRoleId) {
      toast.error(t("rbac.selectRole"));
      return;
    }

    if (shareType === "user" && selectedUserId === currentUserId) {
      toast.error(t("rbac.cannotShareWithSelf"));
      return;
    }

    try {
      await shareHost(hostId, {
        targetType: shareType,
        targetUserId: shareType === "user" ? selectedUserId : undefined,
        targetRoleId: shareType === "role" ? selectedRoleId : undefined,
        permissionLevel,
        durationHours: expiresInHours
          ? parseInt(expiresInHours, 10)
          : undefined,
      });

      toast.success(t("rbac.sharedSuccessfully"));
      setSelectedUserId("");
      setSelectedRoleId(null);
      setExpiresInHours("");
      loadAccessList();
    } catch (error) {
      toast.error(t("rbac.failedToShare"));
    }
  };

  const handleRevoke = async (accessId: number) => {
    if (!hostId) return;

    const confirmed = await confirmWithToast({
      title: t("rbac.confirmRevokeAccess"),
      description: t("rbac.confirmRevokeAccessDescription"),
      confirmText: t("common.revoke"),
      cancelText: t("common.cancel"),
    });

    if (!confirmed) return;

    try {
      await revokeHostAccess(hostId, accessId);
      toast.success(t("rbac.accessRevokedSuccessfully"));
      loadAccessList();
    } catch (error) {
      toast.error(t("rbac.failedToRevokeAccess"));
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString();
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const availableUsers = React.useMemo(() => {
    return users.filter((user) => user.id !== currentUserId);
  }, [users, currentUserId]);

  const selectedUser = availableUsers.find((u) => u.id === selectedUserId);
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  if (isNewHost) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t("rbac.saveHostFirst")}</AlertTitle>
        <AlertDescription>
          {t("rbac.saveHostFirstDescription")}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {!hostData?.credentialId && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("rbac.credentialRequired")}</AlertTitle>
          <AlertDescription>
            {t("rbac.credentialRequiredDescription")}
          </AlertDescription>
        </Alert>
      )}

      {hostData?.credentialId && (
        <>
          <div className="space-y-4 border rounded-lg p-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {t("rbac.shareHost")}
            </h3>

            <Tabs
              value={shareType}
              onValueChange={(v) => setShareType(v as "user" | "role")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="user" className="flex items-center gap-2">
                  <UserCircle className="h-4 w-4" />
                  {t("rbac.shareWithUser")}
                </TabsTrigger>
                <TabsTrigger value="role" className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t("rbac.shareWithRole")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="user" className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="user-select">{t("rbac.selectUser")}</label>
                  <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={userComboOpen}
                        className="w-full justify-between"
                      >
                        {selectedUser
                          ? `${selectedUser.username}${selectedUser.is_admin ? " (Admin)" : ""}`
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
                        <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                          {availableUsers.map((user) => (
                            <CommandItem
                              key={user.id}
                              value={`${user.username} ${user.id}`}
                              onSelect={() => {
                                setSelectedUserId(user.id);
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
              </TabsContent>

              <TabsContent value="role" className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="role-select">{t("rbac.selectRole")}</label>
                  <Popover open={roleComboOpen} onOpenChange={setRoleComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={roleComboOpen}
                        className="w-full justify-between"
                      >
                        {selectedRole
                          ? `${t(selectedRole.displayName)}${selectedRole.isSystem ? ` (${t("rbac.systemRole")})` : ""}`
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
                        <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                          {roles.map((role) => (
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
                </div>
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <label>{t("rbac.permissionLevel")}</label>
              <div className="text-sm text-muted-foreground">
                {t("rbac.view")} - {t("rbac.viewDesc")}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="expires-in">{t("rbac.durationHours")}</label>
              <Input
                id="expires-in"
                type="number"
                value={expiresInHours}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "" || /^\d+$/.test(value)) {
                    setExpiresInHours(value);
                  }
                }}
                placeholder={t("rbac.neverExpires")}
                min="1"
              />
            </div>

            <Button
              type="button"
              onClick={handleShare}
              className="w-full"
              disabled={!hostData?.credentialId}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("rbac.share")}
            </Button>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("rbac.accessList")}
            </h3>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rbac.type")}</TableHead>
                  <TableHead>{t("rbac.target")}</TableHead>
                  <TableHead>{t("rbac.permissionLevel")}</TableHead>
                  <TableHead>{t("rbac.grantedBy")}</TableHead>
                  <TableHead>{t("rbac.expires")}</TableHead>
                  <TableHead className="text-right">
                    {t("common.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : accessList.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      {t("rbac.noAccessRecords")}
                    </TableCell>
                  </TableRow>
                ) : (
                  accessList.map((access) => (
                    <TableRow
                      key={access.id}
                      className={
                        isExpired(access.expiresAt) ? "opacity-50" : ""
                      }
                    >
                      <TableCell>
                        {access.targetType === "user" ? (
                          <Badge
                            variant="outline"
                            className="flex items-center gap-1 w-fit"
                          >
                            <UserCircle className="h-3 w-3" />
                            {t("rbac.user")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="flex items-center gap-1 w-fit"
                          >
                            <Shield className="h-3 w-3" />
                            {t("rbac.role")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {access.targetType === "user"
                          ? access.username
                          : t(access.roleDisplayName || access.roleName || "")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {access.permissionLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>{access.grantedByUsername}</TableCell>
                      <TableCell>
                        {access.expiresAt ? (
                          <div className="flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            <span
                              className={
                                isExpired(access.expiresAt)
                                  ? "text-red-500"
                                  : ""
                              }
                            >
                              {formatDate(access.expiresAt)}
                              {isExpired(access.expiresAt) && (
                                <span className="ml-2">
                                  ({t("rbac.expired")})
                                </span>
                              )}
                            </span>
                          </div>
                        ) : (
                          t("rbac.never")
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevoke(access.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
