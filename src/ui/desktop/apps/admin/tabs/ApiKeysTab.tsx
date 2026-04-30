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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  ChevronsUpDown,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getApiKeys,
  createApiKey,
  deleteApiKey,
  getUserList,
  type ApiKey,
  type CreatedApiKey,
} from "@/ui/main-axios.ts";

interface UserOption {
  id: string;
  username: string;
}

function UserCombobox({
  users,
  value,
  onChange,
  disabled,
}: {
  users: UserOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const selected = users.find((u) => u.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          {selected ? selected.username : t("admin.apiKeys.selectUser")}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
      >
        <Command>
          <CommandInput placeholder={t("admin.apiKeys.searchUsers")} />
          <CommandList>
            <CommandEmpty>{t("admin.apiKeys.noUsersFound")}</CommandEmpty>
            <CommandGroup className="max-h-[200px] overflow-y-auto thin-scrollbar">
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.username}
                  onSelect={() => {
                    onChange(user.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === user.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {user.username}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [users, setUsers] = React.useState<UserOption[]>([]);
  const [createdKey, setCreatedKey] = React.useState<CreatedApiKey | null>(
    null,
  );
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (createdKey) return;

    setUsersLoading(true);
    getUserList()
      .then((res) =>
        setUsers(
          res.users.map((u) => ({
            id: (u as unknown as { id: string }).id,
            username: u.username,
          })),
        ),
      )
      .catch(() => toast.error(t("admin.failedToFetchUsers")))
      .finally(() => setUsersLoading(false));
  }, [open]);

  const handleClose = () => {
    setCreatedKey(null);
    setName("");
    setSelectedUserId("");
    setExpiresAt("");
    setCopied(false);
    onOpenChange(false);
    onCreated();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("admin.apiKeys.nameRequired"));
      return;
    }
    if (!selectedUserId) {
      toast.error(t("admin.apiKeys.userRequired"));
      return;
    }

    setLoading(true);
    try {
      const result = await createApiKey(
        name.trim(),
        selectedUserId,
        expiresAt || undefined,
      );
      setCreatedKey(result);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(
        e?.response?.data?.error || t("admin.apiKeys.failedToCreate"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.token);
    setCopied(true);
    toast.success(t("admin.apiKeys.tokenCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            {createdKey
              ? t("admin.apiKeys.keyCreated")
              : t("admin.apiKeys.createApiKey")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {createdKey
              ? t("admin.apiKeys.keyCreatedDescription")
              : t("admin.apiKeys.createApiKeyDescription")}
          </DialogDescription>
        </DialogHeader>

        {!createdKey ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("admin.apiKeys.keyName")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("admin.apiKeys.keyNamePlaceholder")}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>{t("admin.apiKeys.scopedUser")}</Label>
              {usersLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin.loading")}
                </p>
              ) : (
                <UserCombobox
                  users={users}
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                  disabled={loading}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>
                {t("admin.apiKeys.expiresAt")}{" "}
                <span className="text-muted-foreground text-xs">
                  ({t("admin.apiKeys.optional")})
                </span>
              </Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={loading}
                min={new Date().toISOString().split("T")[0]}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.apiKeys.expiresAtHelp")}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <AlertTitle>{t("admin.apiKeys.copyWarningTitle")}</AlertTitle>
              <AlertDescription>
                {t("admin.apiKeys.copyWarningDescription")}
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>{t("admin.apiKeys.apiKey")}</Label>
              <div className="flex gap-2 items-start">
                <code className="flex-1 block rounded bg-muted px-3 py-2 text-xs font-mono break-all border border-edge">
                  {createdKey.token}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!createdKey ? (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={loading || usersLoading}>
                {loading
                  ? t("admin.apiKeys.creating")
                  : t("admin.apiKeys.createApiKey")}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>{t("common.done")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysTab(): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  const fetchKeys = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await getApiKeys();
      setKeys(data.apiKeys);
    } catch {
      toast.error(t("admin.apiKeys.failedToFetch"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleDelete = (keyId: string, keyName: string) => {
    confirmWithToast(
      t("admin.apiKeys.confirmRevoke", { name: keyName }),
      async () => {
        try {
          await deleteApiKey(keyId);
          toast.success(t("admin.apiKeys.revokedSuccessfully"));
          fetchKeys();
        } catch {
          toast.error(t("admin.apiKeys.failedToRevoke"));
        }
      },
      "destructive",
    );
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return t("admin.apiKeys.never");
    const d = new Date(iso);
    return (
      d.toLocaleDateString() +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const isExpired = (expiresAt: string | null) =>
    expiresAt ? new Date(expiresAt) < new Date() : false;

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("admin.apiKeys.title")}</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() =>
              window.open("https://docs.termix.site/api-keys", "_blank")
            }
          >
            {t("common.documentation")}
          </Button>
          <Button
            onClick={fetchKeys}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-1", loading && "animate-spin")}
            />
            {loading ? t("admin.loading") : t("admin.refresh")}
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("admin.apiKeys.createApiKey")}
          </Button>
        </div>
      </div>

      {loading && keys.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("admin.loading")}
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("admin.apiKeys.noKeys")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.apiKeys.name")}</TableHead>
              <TableHead>{t("admin.user")}</TableHead>
              <TableHead>{t("admin.apiKeys.prefix")}</TableHead>
              <TableHead>{t("admin.created")}</TableHead>
              <TableHead>{t("admin.expires")}</TableHead>
              <TableHead>{t("admin.apiKeys.lastUsed")}</TableHead>
              <TableHead>{t("admin.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="px-4 font-medium">
                  {key.name}
                  {!key.isActive && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      {t("admin.revoked")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="px-4">
                  {key.username || key.userId}
                </TableCell>
                <TableCell className="px-4">
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {key.tokenPrefix}…
                  </code>
                </TableCell>
                <TableCell className="px-4 text-sm text-muted-foreground">
                  {formatDate(key.createdAt)}
                </TableCell>
                <TableCell className="px-4 text-sm">
                  <span
                    className={
                      isExpired(key.expiresAt)
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }
                  >
                    {formatDate(key.expiresAt)}
                  </span>
                </TableCell>
                <TableCell className="px-4 text-sm text-muted-foreground">
                  {formatDate(key.lastUsedAt)}
                </TableCell>
                <TableCell className="px-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(key.id, key.name)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    title={t("admin.apiKeys.revokeKey")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateApiKeyDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={fetchKeys}
      />
    </div>
  );
}
