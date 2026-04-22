import React from "react";
import { cn } from "@/lib/utils.ts";
import { useTheme } from "@/components/theme-provider";

interface ElectronAuthShellProps {
  children: React.ReactNode;
  contentMode?: "form" | "wide" | "fullbleed";
}

export function ElectronAuthShell({
  children,
  contentMode = "form",
}: ElectronAuthShellProps) {
  const { theme } = useTheme();

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      style={{
        background: "var(--bg-elevated)",
        backgroundImage: `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 35px,
          ${lineColor} 35px,
          ${lineColor} 37px
        )`,
      }}
    >
      <div
        className={cn("h-full w-full", {
          "flex items-center justify-center p-4": contentMode === "form",
          "flex items-center justify-center p-6": contentMode === "wide",
          "overflow-hidden": contentMode === "fullbleed",
        })}
      >
        <div
          className={cn({
            "w-full max-w-md": contentMode === "form",
            "h-full w-full max-w-5xl": contentMode === "wide",
            "h-full w-full": contentMode === "fullbleed",
          })}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
