import { useState } from "react";
import { toast } from "sonner";

interface ConfirmationOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

export function useConfirmation() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  const confirm = (opts: ConfirmationOptions, callback: () => void) => {
    setOptions(opts);
    setOnConfirm(() => callback);
    setIsOpen(true);
  };

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    setIsOpen(false);
    setOptions(null);
    setOnConfirm(null);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setOptions(null);
    setOnConfirm(null);
  };

  const confirmWithToast = (
    opts: ConfirmationOptions | string,
    callback?: () => void,
    variantOrConfirmLabel: "default" | "destructive" | string = "Confirm",
    cancelLabel: string = "Cancel",
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const isVariant =
        variantOrConfirmLabel === "default" ||
        variantOrConfirmLabel === "destructive";
      const confirmLabel = isVariant ? "Confirm" : variantOrConfirmLabel;

      if (typeof opts === "string") {
        toast(opts, {
          action: {
            label: confirmLabel,
            onClick: () => {
              if (callback) callback();
              resolve(true);
            },
          },
          cancel: {
            label: cancelLabel,
            onClick: () => {
              resolve(false);
            },
          },
        } as any);
      } else if (typeof opts === "object") {
        const actualConfirmLabel = opts.confirmText || confirmLabel;
        const actualCancelLabel = opts.cancelText || cancelLabel;

        toast(opts.description, {
          action: {
            label: actualConfirmLabel,
            onClick: () => {
              if (callback) callback();
              resolve(true);
            },
          },
          cancel: {
            label: actualCancelLabel,
            onClick: () => {
              resolve(false);
            },
          },
        } as any);
      } else {
        resolve(false);
      }
    });
  };

  return {
    isOpen,
    options,
    confirm,
    handleConfirm,
    handleCancel,
    confirmWithToast,
  };
}
