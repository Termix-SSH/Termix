import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";
import { UserPlus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { registerUser } from "@/ui/main-axios";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateUserDialogProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
      setError(null);
    }
  }, [open]);

  const handleCreateUser = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (!username.trim()) {
      setError(t("admin.enterUsername"));
      return;
    }

    if (!password.trim()) {
      setError(t("admin.enterPassword"));
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await registerUser(username.trim(), password);
      toast.success(
        t("admin.userCreatedSuccessfully", { username: username.trim() }),
      );
      setUsername("");
      setPassword("");
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      const errorMessage =
        error?.response?.data?.error || t("admin.failedToCreateUser");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!loading) {
          onOpenChange(newOpen);
        }
      }}
    >
      <DialogContent className="sm:max-w-[500px] bg-dark-bg border-2 border-dark-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            {t("admin.createUser")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("admin.createUserDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreateUser} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="create-username">{t("admin.username")}</Label>
            <Input
              id="create-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder={t("admin.enterUsername")}
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-password">{t("common.password")}</Label>
            <PasswordInput
              id="create-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder={t("admin.enterPassword")}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateUser();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Password must be at least 6 characters
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("common.error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>

        <DialogFooter>
          <Button onClick={() => handleCreateUser()} disabled={loading}>
            {loading ? t("common.creating") : t("admin.createUser")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
