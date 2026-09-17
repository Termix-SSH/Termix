import { getErrorMessage } from "../../lib/error-message.js";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/button";
import {
  markAiProposalRunInTerminal,
  rejectAiProposal,
  type AiProposal,
} from "@/api/ai-api";
import { ProposalCard } from "@/features/ai/ProposalCard";

interface TerminalProposalCardProps {
  proposal: AiProposal;
  hostId: number;
  onRunInTerminal: (command: string) => void;
  onResolved: (
    id: number,
    status: "applied" | "rejected",
    resultSummary?: string,
  ) => void;
}

/**
 * A run_command proposal in the terminal-docked assistant runs in the user's
 * already-open session instead of a hidden pooled connection, so approving it
 * here is a different action from the main AiPanel's apply button. Every
 * other proposal kind still goes through the normal apply flow.
 */
export function TerminalProposalCard({
  proposal,
  hostId,
  onRunInTerminal,
  onResolved,
}: TerminalProposalCardProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"run" | "reject" | null>(null);

  if (
    proposal.kind !== "propose_run_command" ||
    proposal.status !== "pending"
  ) {
    return <ProposalCard proposal={proposal} onResolved={onResolved} />;
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(proposal.payload);
  } catch {
    payload = {};
  }
  const command = typeof payload.command === "string" ? payload.command : "";
  const explanation =
    typeof payload.explanation === "string" ? payload.explanation : "";

  async function handleRun() {
    if (!command) return;
    setBusy("run");
    try {
      onRunInTerminal(command);
      const result = await markAiProposalRunInTerminal(
        proposal.id,
        hostId,
        `$ ${command}`,
      );
      onResolved(proposal.id, "applied", result.summary);
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.proposalApplyFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    setBusy("reject");
    try {
      await rejectAiProposal(proposal.id);
      onResolved(proposal.id, "rejected");
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.proposalRejectFailed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-none border border-border bg-muted p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {t("ai.runCommandTitle")}
        </span>
      </div>

      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-border bg-background px-2 py-1.5 font-mono text-[11px] leading-snug">
        {command}
      </pre>

      {explanation && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {explanation}
        </p>
      )}

      <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <TriangleAlert size={11} className="shrink-0" />
        {t("ai.runsInOpenTerminal")}
      </p>

      <div className="mt-2 flex gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          variant="outline"
          disabled={busy !== null || !command}
          onClick={handleRun}
        >
          {busy === "run" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Check size={13} />
          )}
          {t("ai.runInTerminal")}
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          variant="outline"
          disabled={busy !== null}
          onClick={handleReject}
        >
          {busy === "reject" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <X size={13} />
          )}
          {t("ai.reject")}
        </Button>
      </div>
    </div>
  );
}
