import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { useRef } from "react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const lastToastRef = useRef<{ text: string; timestamp: number } | null>(null);

  const originalToast = toast;

  const rateLimitedToast = (message: string, options?: any) => {
    const now = Date.now();
    const lastToast = lastToastRef.current;

    if (
      lastToast &&
      lastToast.text === message &&
      now - lastToast.timestamp < 1000
    ) {
      return;
    }

    lastToastRef.current = { text: message, timestamp: now };
    return originalToast(message, options);
  };

  Object.assign(toast, {
    success: (message: string, options?: any) =>
      rateLimitedToast(message, { ...options, type: "success" }),
    error: (message: string, options?: any) =>
      rateLimitedToast(message, { ...options, type: "error" }),
    warning: (message: string, options?: any) =>
      rateLimitedToast(message, { ...options, type: "warning" }),
    info: (message: string, options?: any) =>
      rateLimitedToast(message, { ...options, type: "info" }),
    message: rateLimitedToast,
  });

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
