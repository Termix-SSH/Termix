import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog.tsx";
import { Button } from "@/components/button.tsx";

const DONATE_URL = "https://donate.termix.site/donate/";

interface DonationReminderModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function DonationReminderModal({
  open,
  onDismiss,
}: DonationReminderModalProps) {
  const { t } = useTranslation();

  const handleDonate = () => {
    window.open(DONATE_URL, "_blank", "noopener,noreferrer");
    onDismiss();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("donation.title")}</DialogTitle>
          <DialogDescription>{t("donation.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>
            {t("donation.dismiss")}
          </Button>
          <Button onClick={handleDonate}>{t("donation.cta")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
