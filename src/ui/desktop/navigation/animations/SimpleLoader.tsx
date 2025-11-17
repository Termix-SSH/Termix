import React from "react";
import { cn } from "@/lib/utils.ts";

interface SimpleLoaderProps {
  visible: boolean;
  message?: string;
  className?: string;
  backgroundColor?: string;
}

export function SimpleLoader({
  visible,
  message,
  className,
  backgroundColor,
}: SimpleLoaderProps) {
  if (!visible) {
    return null;
  }

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          .simple-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.1);
            border-top-color: rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
        `}
      </style>

      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center z-50",
          className,
        )}
        style={{ backgroundColor: backgroundColor || "#18181b" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="simple-spinner"></div>
          {message && (
            <p className="text-sm text-gray-300 font-medium">{message}</p>
          )}
        </div>
      </div>
    </>
  );
}
