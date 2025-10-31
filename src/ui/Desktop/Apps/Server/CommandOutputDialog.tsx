import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { useTranslation } from "react-i18next";
import { X, Terminal } from "lucide-react";

interface CommandOutputDialogProps {
  isOpen: boolean;
  output: string;
  errorOutput: string;
  exitCode: number;
  commandLabel: string;
  onClose: () => void;
}

export function CommandOutputDialog({
  isOpen,
  output,
  errorOutput,
  exitCode,
  commandLabel,
  onClose,
}: CommandOutputDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const hasOutput = output || errorOutput;
  const isSuccess = exitCode === 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="bg-dark-bg border border-dark-border rounded-xl shadow-2xl max-w-4xl w-full mx-4 relative z-10 max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-dark-border/50 bg-dark-bg/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-primary" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-base font-semibold text-gray-100">
                {commandLabel}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("serverStats.commandOutput")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 hover:bg-dark-bg-darker"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-6 py-3 border-b border-dark-border/50 bg-dark-bg/30">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Exit Code
            </span>
            <span
              className={`text-sm font-mono font-semibold ${isSuccess ? "text-green-400" : "text-red-400"}`}
            >
              {exitCode}
            </span>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${isSuccess ? "bg-green-500/15 text-green-400 border border-green-500/20" : "bg-red-500/15 text-red-400 border border-red-500/20"}`}
            >
              {isSuccess ? "✓ Success" : "✗ Failed"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-6 pt-4">
          {hasOutput ? (
            <div className="flex-1 overflow-y-auto bg-black/40 rounded-lg border border-dark-border p-5 font-mono text-sm">
              {output && (
                <div className="mb-6 last:mb-0">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-dark-border/30">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                    <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">
                      STDOUT
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-gray-200 leading-relaxed">
                    {output}
                  </pre>
                </div>
              )}
              {errorOutput && (
                <div>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-dark-border/30">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
                    <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                      STDERR
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-red-300 leading-relaxed">
                    {errorOutput}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-dark-bg-darker rounded-lg border border-dark-border/50">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-dark-bg/50 flex items-center justify-center">
                  <Terminal className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-sm">
                  No output from command
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
          <Button onClick={onClose} className="w-full font-medium">
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
