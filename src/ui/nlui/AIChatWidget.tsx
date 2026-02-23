import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useAIEngine } from "./useAIEngine";
import { AIChatPanel } from "./AIChatPanel";

/**
 * Floating AI chat widget — a "T" button in the bottom-right corner.
 * Clicking it opens a chat panel powered by the NLUI engine.
 */
export function AIChatWidget(): React.ReactElement | null {
  const { t } = useTranslation();
  const { engine, loading, error } = useAIEngine();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Don't render if no LLM config
  if (error === "noConfig") return null;

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  return (
    <>
      {/* Floating T button */}
      {(!isOpen || isMinimized) && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center font-bold text-lg select-none"
          title={t("ai.title")}
        >
          T
        </button>
      )}

      {/* Chat panel */}
      {isOpen && !isMinimized && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[550px]">
          {loading ? (
            <div className="flex items-center justify-center h-full bg-canvas rounded-lg border-2 border-edge shadow-xl">
              <div className="text-sm text-muted-foreground animate-pulse">
                {t("ai.loading")}
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full bg-canvas rounded-lg border-2 border-edge shadow-xl p-4">
              <div className="text-sm text-destructive text-center">
                {error}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={handleClose}
                >
                  {t("ai.close")}
                </Button>
              </div>
            </div>
          ) : engine ? (
            <AIChatPanel
              engine={engine}
              onClose={handleClose}
              onMinimize={handleMinimize}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
