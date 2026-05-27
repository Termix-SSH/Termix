"use client";

import { useTheme } from "@/components/theme-provider";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:rounded-none! group-[.toaster]:shadow-lg group-[.toaster]:font-mono",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-accent-brand group-[.toast]:text-white group-[.toast]:font-semibold",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toast]:!text-accent-brand group-[.toast]:!border-accent-brand/30",
          info: "group-[.toast]:!text-accent-brand group-[.toast]:!border-accent-brand/30",
          error:
            "group-[.toast]:!text-destructive group-[.toast]:!border-destructive/30",
        },
      }}
      style={
        {
          "--radius": "0px",
          "--normal-bg": "var(--card)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--card-foreground)",
          "--success-bg": "var(--card)",
          "--success-border": "var(--border)",
          "--success-text": "var(--color-accent-brand)",
          "--info-bg": "var(--card)",
          "--info-border": "var(--border)",
          "--info-text": "var(--color-accent-brand)",
          "--error-bg": "var(--card)",
          "--error-border": "var(--border)",
          "--error-text": "var(--destructive)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
