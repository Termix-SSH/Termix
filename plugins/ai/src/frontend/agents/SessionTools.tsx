import { useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { aiApp } from "../app-ref";
import type { AgentSession } from "../../backend/agents/types";
import type { SessionActions } from "./AgentComposer";

export function SessionTools({
  session: s,
  busy,
  action,
  onUpdated,
  onWorktree,
}: SessionActions & { onWorktree: (path: string) => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(s.title ?? ""),
    [file, setFile] = useState(""),
    [branch, setBranch] = useState("");
  const [result, setResult] = useState(""),
    [worktree, setWorktree] = useState("");
  async function patch(body: unknown) {
    onUpdated(
      (await aiApp().api.patch<AgentSession>(`/agents/${s.id}`, body)).data,
    );
  }
  const [files, setFiles] = useState<{ status: string; path: string }[]>([]);
  async function inspect(operation: string, path = file) {
    const r = await aiApp().api.post<{
      status?: string;
      files?: { status: string; path: string }[];
      diff?: string;
      branch?: string;
      path?: string;
    }>(`/agents/${s.id}/workspace`, { operation, path, branch });
    if (r.data.files) setFiles(r.data.files);
    setResult(
      [r.data.branch, r.data.status, r.data.diff, r.data.path]
        .filter(Boolean)
        .join("\n") || t("agents.clean"),
    );
    if (r.data.path) setWorktree(r.data.path);
  }
  return (
    <div className="border-b p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          aria-label={t("agents.sessionName")}
          placeholder={t("agents.sessionName")}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void action(() => patch({ title }))}
        >
          {t("agents.rename")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void action(() => patch({ archived: !s.archived }))}
        >
          {t(s.archived ? "agents.restore" : "agents.archive")}
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">
          {t("agents.review")}
        </summary>
        <div className="my-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action(() => inspect("status"))}
          >
            {t("agents.gitStatus")}
          </Button>
          <Input
            className="max-w-sm"
            aria-label={t("agents.diffFile")}
            placeholder={t("agents.diffFile")}
            value={file}
            onChange={(e) => setFile(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !file}
            onClick={() => void action(() => inspect("diff"))}
          >
            {t("agents.diff")}
          </Button>
          <Input
            className="max-w-sm"
            aria-label={t("agents.branch")}
            placeholder={t("agents.branch")}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !branch}
            onClick={() => void action(() => inspect("worktree"))}
          >
            {t("agents.createWorktree")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("agents.worktreeHint")}
        </p>
        {files.length > 0 && (
          <div className="max-h-32 overflow-auto my-2">
            {files.map((f) => (
              <button
                key={f.path}
                className="block text-left text-sm hover:underline"
                disabled={busy}
                onClick={() => {
                  setFile(f.path);
                  void action(() => inspect("diff", f.path));
                }}
              >
                {f.status} {f.path}
              </button>
            ))}
          </div>
        )}
        {worktree && (
          <Button size="sm" onClick={() => onWorktree(worktree)}>
            {t("agents.useWorktree")}
          </Button>
        )}
        {result && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">
            {result}
          </pre>
        )}
      </details>
    </div>
  );
}
