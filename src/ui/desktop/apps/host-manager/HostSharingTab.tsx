import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  AlertCircle,
  Plus,
  Trash2,
  Users,
  Shield,
  Clock,
  UserCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getRoles,
  getUserList,
  getUserInfo,
  shareHost,
  getHostAccess,
  revokeHostAccess,
  type Role,
  type AccessRecord,
} from "@/ui/main-axios.ts";

interface HostSharingTabProps {
  hostId: number | undefined;
  isNewHost: boolean;
}

interface User {
  id: string;
  username: string;
  is_admin: boolean;
}

const PERMISSION_LEVELS = [
  { value: "view", labelKey: "rbac.view" },
  { value: "manage", labelKey: "rbac.manage" },
];

export function HostSharingTab({
  hostId,
  isNewHost,
}: HostSharingTabProps): React.ReactElement {
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

  // Load roles
  const loadRoles = React.useCallback(async () => {
    try {
      const response = await getRoles();
      setRoles(response.roles || []);
    } catch (error) {
      console.error("Failed to load roles:", error);
      setRoles([]);
    }
  }, []);

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

  // Load access list
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

  React.useEffect(() => {
    loadRoles();
    loadUsers();
    if (!isNewHost) {
      loadAccessList();
    }
  }, [loadRoles, loadUsers, loadAccessList, isNewHost]);

  // Load current user ID
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

  // Share host
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

    // Prevent sharing with self
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
        durationHours: expiresInHours ? parseInt(expiresInHours, 10) : undefined,
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

  // Revoke access
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

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString();
  };

  // Check if expired
  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

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
      {/* Share Form */}
      <div className="space-y-4 border rounded-lg p-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5" />
          {t("rbac.shareHost")}
        </h3>

        {/* Share Type Selection */}
        <Tabs value={shareType} onValueChange={(v) => setShareType(v as "user" | "role")}>
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
              <Label htmlFor="user-select">{t("rbac.selectUser")}</Label>
              <Select value={selectedUserId || ""} onValueChange={setSelectedUserId}>
                <SelectTrigger id="user-select">
                  <SelectValue placeholder={t("rbac.selectUserPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.username}{user.is_admin ? " (Admin)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="role" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-select">{t("rbac.selectRole")}</Label>
              <Select
                value={selectedRoleId !== null ? selectedRoleId.toString() : ""}
                onValueChange={(v) => {
                  const parsed = parseInt(v, 10);
                  setSelectedRoleId(isNaN(parsed) ? null : parsed);
                }}
              >
                <SelectTrigger id="role-select">
                  <SelectValue placeholder={t("rbac.selectRolePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id.toString()}>
                      {t(role.displayName)}{role.isSystem ? ` (${t("rbac.systemRole")})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        {/* Permission Level */}
        <div className="space-y-2">
          <Label htmlFor="permission-level">{t("rbac.permissionLevel")}</Label>
          <Select value={permissionLevel || "use"} onValueChange={(v) => setPermissionLevel(v || "use")}>
            <SelectTrigger id="permission-level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERMISSION_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  {t(level.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Expiration */}
        <div className="space-y-2">
          <Label htmlFor="expires-in">
            {t("rbac.durationHours")}
          </Label>
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

        <Button type="button" onClick={handleShare} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          {t("rbac.share")}
        </Button>
      </div>

      {/* Access List */}
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
              <TableHead>{t("rbac.accessCount")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            ) : accessList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("rbac.noAccessRecords")}
                </TableCell>
              </TableRow>
            ) : (
              accessList.map((access) => (
                <TableRow
                  key={access.id}
                  className={isExpired(access.expiresAt) ? "opacity-50" : ""}
                >
                  <TableCell>
                    {access.targetType === "user" ? (
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <UserCircle className="h-3 w-3" />
                        {t("rbac.user")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
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
                    <Badge variant="secondary">{access.permissionLevel}</Badge>
                  </TableCell>
                  <TableCell>{access.grantedByUsername}</TableCell>
                  <TableCell>
                    {access.expiresAt ? (
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        <span className={isExpired(access.expiresAt) ? "text-red-500" : ""}>
                          {formatDate(access.expiresAt)}
                          {isExpired(access.expiresAt) && (
                            <span className="ml-2">({t("rbac.expired")})</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      t("rbac.never")
                    )}
                  </TableCell>
                  <TableCell>{access.accessCount}</TableCell>
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
    </div>
  );
}
