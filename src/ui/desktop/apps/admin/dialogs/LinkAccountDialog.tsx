import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { linkOIDCToPasswordAccount } from "@/ui/main-axios.ts";

interface LinkAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oidcUser: { id: string; username: string } | null;
  onSuccess: () => void;
}

export function LinkAccountDialog({
  open,
  onOpenChange,
  oidcUser,
  onSuccess,
}: LinkAccountDialogProps) {
  const { t } = useTranslation();
  const [linkTargetUsername, setLinkTargetUsername] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setLinkTargetUsername("");
    }
  }, [open]);

  const handleLinkSubmit = async () => {
    if (!oidcUser || !linkTargetUsername.trim()) {
      toast.error("Target username is required");
      return;
    }

    setLinkLoading(true);
    try {
      const result = await linkOIDCToPasswordAccount(
        oidcUser.id,
        linkTargetUsername.trim(),
      );

      toast.success(
        result.message ||
          `OIDC user ${oidcUser.username} linked to ${linkTargetUsername}`,
      );
      setLinkTargetUsername("");
      onSuccess();
      onOpenChange(false);
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { error?: string; code?: string } };
      };
      toast.error(err.response?.data?.error || "Failed to link accounts");
    } finally {
      setLinkLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            {t("admin.linkOidcToPasswordAccount")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("admin.linkOidcToPasswordAccountDescription", {
              username: oidcUser?.username,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert variant="destructive">
            <AlertTitle>{t("admin.linkOidcWarningTitle")}</AlertTitle>
            <AlertDescription>
              {t("admin.linkOidcWarningDescription")}
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>{t("admin.linkOidcActionDeleteUser")}</li>
                <li>{t("admin.linkOidcActionAddCapability")}</li>
                <li>{t("admin.linkOidcActionDualAuth")}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label
              htmlFor="link-target-username"
              className="text-base font-semibold text-foreground"
            >
              {t("admin.linkTargetUsernameLabel")}
            </Label>
            <Input
              id="link-target-username"
              value={linkTargetUsername}
              onChange={(e) => setLinkTargetUsername(e.target.value)}
              placeholder={t("admin.linkTargetUsernamePlaceholder")}
              disabled={linkLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && linkTargetUsername.trim()) {
                  handleLinkSubmit();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={linkLoading}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleLinkSubmit}
            disabled={linkLoading || !linkTargetUsername.trim()}
            variant="destructive"
          >
            {linkLoading
              ? t("admin.linkingAccounts")
              : t("admin.linkAccountsButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
