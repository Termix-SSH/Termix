import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface ConfirmationOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

interface ToastConfirmOptions {
  confirmOnEnter?: boolean;
  duration?: number;
}

export function useConfirmation() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  const [activeToastId, setActiveToastId] = useState<string | number | null>(null);
  const [pendingConfirmCallback, setPendingConfirmCallback] = useState<(() => void) | null>(null);
  const [pendingResolve, setPendingResolve] = useState<((value: boolean) => void) | null>(null);

  const handleEnterKey = useCallback((event: KeyboardEvent) => {
    if (event.key === "Enter" && activeToastId !== null) {
      event.preventDefault();
      event.stopPropagation();

      if (pendingConfirmCallback) {
        pendingConfirmCallback();
      }
      if (pendingResolve) {
        pendingResolve(true);
      }

      toast.dismiss(activeToastId);
      setActiveToastId(null);
      setPendingConfirmCallback(null);
      setPendingResolve(null);
    }
  }, [activeToastId, pendingConfirmCallback, pendingResolve]);

  useEffect(() => {
    if (activeToastId !== null) {
      // Use capture phase to intercept Enter before terminal receives it
      window.addEventListener("keydown", handleEnterKey, true);
      return () => {
        window.removeEventListener("keydown", handleEnterKey, true);
      };
    }
  }, [activeToastId, handleEnterKey]);

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
    toastOptions: ToastConfirmOptions = { confirmOnEnter: false },
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const isVariant =
        variantOrConfirmLabel === "default" ||
        variantOrConfirmLabel === "destructive";
      const confirmLabel = isVariant ? "Confirm" : variantOrConfirmLabel;

      const { confirmOnEnter = false, duration = 8000 } = toastOptions;

      const handleToastConfirm = () => {
        if (callback) callback();
        resolve(true);
        setActiveToastId(null);
        setPendingConfirmCallback(null);
        setPendingResolve(null);
      };

      const handleToastCancel = () => {
        resolve(false);
        setActiveToastId(null);
        setPendingConfirmCallback(null);
        setPendingResolve(null);
      };

      const message = typeof opts === "string" ? opts : opts.description;
      const actualConfirmLabel = typeof opts === "object" && opts.confirmText ? opts.confirmText : confirmLabel;
      const actualCancelLabel = typeof opts === "object" && opts.cancelText ? opts.cancelText : cancelLabel;

      const toastId = toast(message, {
        duration,
        action: {
          label: confirmOnEnter ? `${actualConfirmLabel} ↵` : actualConfirmLabel,
          onClick: handleToastConfirm,
        },
        cancel: {
          label: actualCancelLabel,
          onClick: handleToastCancel,
        },
        onDismiss: () => {
          setActiveToastId(null);
          setPendingConfirmCallback(null);
          setPendingResolve(null);
        },
        onAutoClose: () => {
          resolve(false);
          setActiveToastId(null);
          setPendingConfirmCallback(null);
          setPendingResolve(null);
        },
      } as any);

      if (confirmOnEnter) {
        setActiveToastId(toastId);
        setPendingConfirmCallback(() => () => {
          if (callback) callback();
        });
        setPendingResolve(() => resolve);
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
