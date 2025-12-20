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
    variant?: "default" | "destructive",
  ): Promise<boolean> => {
    // Legacy signature support
    if (typeof opts === "string" && callback) {
      const actionText = variant === "destructive" ? "Delete" : "Confirm";
      const cancelText = "Cancel";

      toast(opts, {
        action: {
          label: actionText,
          onClick: callback,
        },
        cancel: {
          label: cancelText,
          onClick: () => {},
        },
        duration: 10000,
        className: variant === "destructive" ? "border-red-500" : "",
      });
      return Promise.resolve(true);
    }

    // New Promise-based signature
    return new Promise<boolean>((resolve) => {
      const options = opts as ConfirmationOptions;
      const actionText = options.confirmText || "Confirm";
      const cancelText = options.cancelText || "Cancel";
      const variantClass = options.variant === "destructive" ? "border-red-500" : "";

      toast(options.title, {
        description: options.description,
        action: {
          label: actionText,
          onClick: () => resolve(true),
        },
        cancel: {
          label: cancelText,
          onClick: () => resolve(false),
        },
        duration: 10000,
        className: variantClass,
      });
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
