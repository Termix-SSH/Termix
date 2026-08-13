import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/button";
import {
  applyAiProposal,
  rejectAiProposal,
  type AiProposal,
} from "@/api/ai-api";
import { fieldLabel, toolLabel } from "./labels";

interface ProposalCardProps {
  proposal: AiProposal;
  onResolved: (
    id: number,
    status: "applied" | "rejected",
    resultSummary?: string,
  ) => void;
}

function isDestructive(kind: string): boolean {
  return kind.includes("delete");
}

/**
 * Fields shown in their own block rather than the generic row list, so the
 * card does not print the same command twice.
 */
const PROMOTED_FIELDS = new Set(["command", "explanation", "reason"]);

/** Renders the payload as readable field rows rather than raw JSON. */
function fieldRows(payload: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];

  const push = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (PROMOTED_FIELDS.has(key)) return;
    const text =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    rows.push([key, text]);
  };

  for (const [key, value] of Object.entries(payload)) {
    if (key === "changes" && value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        push(childKey, childValue);
      }
      continue;
    }
    push(key, value);
  }

  return rows;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function ProposalCard({ proposal, onResolved }: ProposalCardProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"apply" | "reject" | null>(null);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(proposal.payload);
  } catch {
    payload = {};
  }

  const rows = fieldRows(payload);
  const destructive = isDestructive(proposal.kind);
  const resolved = proposal.status !== "pending";

  const command = asText(payload.command);
  const explanation = asText(payload.explanation) ?? asText(payload.reason);

  // The stored summary repeats the command for run_command proposals, so a
  // short action label is used instead of printing it twice.
  const title =
    command !== null
      ? t("ai.runCommandTitle")
      : (proposal.summary ?? toolLabel(proposal.kind));

  async function handleApply() {
    setBusy("apply");
    try {
      const result = await applyAiProposal(proposal.id);
      // The result goes into the card, not a toast: command output can be
      // hundreds of lines, which covered the screen.
      onResolved(proposal.id, "applied", result.summary);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ai.proposalApplyFailed"),
      );
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
      toast.error(
        error instanceof Error ? error.message : t("ai.proposalRejectFailed"),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-none border border-border bg-muted p-2.5">
      <div className="flex items-center gap-1.5">
        {destructive && (
          <TriangleAlert size={13} className="shrink-0 text-destructive" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </span>
        {resolved && (
          <span className="shrink-0 border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {proposal.status === "applied"
              ? t("ai.statusApplied")
              : t("ai.statusRejected")}
          </span>
        )}
      </div>

      {/*
        A command is the payload, not a field of it, so it gets its own block
        rather than a label column. In the sidebar a fixed label gutter left
        barely any room for the command itself.
      */}
      {command && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-border bg-background px-2 py-1.5 font-mono text-[11px] leading-snug">
          {command}
        </pre>
      )}

      {explanation && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {explanation}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {rows.map(([key, value]) => (
            // Stacked, not a two-column row: the value is what matters and it
            // needs the full width to stay readable.
            <div key={key} className="min-w-0">
              <span className="text-[10px] text-muted-foreground">
                {fieldLabel(key)}
              </span>
              <div className="break-all font-mono text-[11px] leading-snug">
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {proposal.resultSummary && (
        // Command output comes back here, so it keeps the monospace treatment.
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-border bg-background px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
          {proposal.resultSummary}
        </pre>
      )}

      {!resolved && (
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            className={`h-7 flex-1 text-xs ${
              destructive
                ? ""
                : "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            }`}
            variant={destructive ? "destructive" : "outline"}
            disabled={busy !== null}
            onClick={handleApply}
          >
            {busy === "apply" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            {t("ai.approve")}
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
      )}
    </div>
  );
}
