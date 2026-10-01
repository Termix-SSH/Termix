import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  usePermission,
  usePluginApi,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import { Button, Separator } from "@termix/plugin-sdk/ui";
import {
  readQuickActions,
  snippetHostSettings,
  type QuickAction,
} from "../shared/host-settings.js";
import { hasSnippetInputs } from "../shared/variables.js";
import { askForInputs, shouldConfirmExecution } from "./prompt-store";
import { createSnippetsApi } from "./snippets-api";
import { errorMessage } from "./types";

interface ToolbarHost {
  id?: number | string;
  name?: string;
  ip?: string;
  username?: string;
  port?: number;
  pluginSettings?: Record<string, Record<string, unknown>>;
}

/**
 * The host's quick actions as buttons in the Host Metrics toolbar (the
 * host-metrics.toolbar slot). Each runs its snippet on the host over a fresh
 * SSH connection and reports the result in a toast.
 */
export function QuickActionButtons(props: Record<string, unknown>) {
  const host = props.host as ToolbarHost | undefined;
  const { t } = useTranslation();
  const api = usePluginApi();
  const client = useMemo(() => createSnippetsApi(api), [api]);
  const canView = usePermission("view");
  const [running, setRunning] = useState<Set<number>>(new Set());
  const actions = readQuickActions(snippetHostSettings(host).quickActions);
  const hostId = Number(host?.id);

  if (!canView || actions.length === 0 || !Number.isInteger(hostId)) {
    return null;
  }

  const setBusy = (snippetId: number, busy: boolean) =>
    setRunning((prev) => {
      const next = new Set(prev);
      if (busy) next.add(snippetId);
      else next.delete(snippetId);
      return next;
    });

  async function execute(
    action: QuickAction,
    inputValues: Record<string, string>,
  ) {
    const toastId = `quick-action-${hostId}-${action.snippetId}`;
    setBusy(action.snippetId, true);
    toast.loading(t("quickActions.running", { name: action.name }), {
      id: toastId,
    });
    try {
      const result = await client.execute(
        action.snippetId,
        hostId,
        Object.keys(inputValues).length > 0 ? inputValues : undefined,
      );
      if (result.success) {
        toast.success(t("quickActions.succeeded", { name: action.name }), {
          id: toastId,
          description: result.output?.substring(0, 200),
          duration: 5000,
        });
      } else {
        toast.error(t("quickActions.failed", { name: action.name }), {
          id: toastId,
          description: result.error || result.output,
          duration: 5000,
        });
      }
    } catch (error) {
      toast.error(t("quickActions.error", { name: action.name }), {
        id: toastId,
        description: errorMessage(error, t("executionFailed")),
        duration: 5000,
      });
    } finally {
      setBusy(action.snippetId, false);
    }
  }

  async function run(action: QuickAction) {
    let inputValues: Record<string, string> = {};
    const snippet = await client.get(action.snippetId).catch(() => null);
    if (snippet && hasSnippetInputs(snippet.content)) {
      const values = await askForInputs(
        { name: action.name || snippet.name, content: snippet.content },
        host
          ? {
              ip: host.ip,
              username: host.username,
              port: host.port,
              name: host.name,
            }
          : null,
      );
      if (!values) return;
      inputValues = values;
    }
    const go = () => void execute(action, inputValues);
    if (!shouldConfirmExecution()) {
      go();
      return;
    }
    toast(t("confirmRunMessage", { name: action.name }), {
      action: { label: t("confirmRunButton"), onClick: go },
      duration: 6000,
    });
  }

  return (
    <>
      <div className="mr-3 flex flex-wrap gap-2">
        {actions.map((action, index) => {
          const busy = running.has(action.snippetId);
          return (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold"
              disabled={busy}
              onClick={() => void run(action)}
            >
              {busy && <RefreshCw className="mr-1 size-3 animate-spin" />}
              {action.name}
            </Button>
          );
        })}
      </div>
      <Separator orientation="vertical" className="mx-3 h-8" />
    </>
  );
}
