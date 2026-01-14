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
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

interface SudoPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => void;
  operation?: string;
}

export function SudoPasswordDialog({
  open,
  onOpenChange,
  onSubmit,
  operation,
}: SudoPasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (!password.trim()) {
      return;
    }

    setLoading(true);
    onSubmit(password);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
              {t("fileManager.sudoPasswordRequired")}
            </DialogTitle>
            <DialogDescription>
              {t("fileManager.enterSudoPassword")}
              {operation && (
                <span className="block mt-1 text-muted-foreground">
                  {operation}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("fileManager.sudoPassword")}
              autoFocus
              disabled={loading}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!password.trim() || loading}>
              {loading ? t("common.loading") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
