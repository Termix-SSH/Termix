import { toast as sonnerToast } from "sonner";

/**
 * What a plugin gets as `toast` from the shared "sonner" module. Calling it
 * directly, toast("text"), goes straight to sonner's internal store, past the
 * toast.message property the frame forwards to the shell, so the call is
 * routed through that property. Everything else is sonner's own toast.
 */
export const toast = new Proxy(sonnerToast, {
  apply: (target, _this, args) =>
    (target.message as (...a: unknown[]) => unknown)(...args),
}) as typeof sonnerToast;
