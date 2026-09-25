import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  usePluginApi,
  useTranslation,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
import { Button, Input, useConfirmation } from "@termix/plugin-sdk/ui";

// Core's admin routes act on another user's data when this header names them.
export const ADMIN_TARGET_USER_HEADER = "X-Admin-Target-User";

export function adminOptions(targetUserId: string) {
  return { headers: { [ADMIN_TARGET_USER_HEADER]: targetUserId } };
}

interface ManagedSnippet {
  id: number;
  name: string;
  content: string;
  folder?: string | null;
}

export function mapSnippets(res: unknown): ManagedSnippet[] {
  const list = Array.isArray(res)
    ? res
    : ((res as { snippets?: unknown[] })?.snippets ?? []);
  return (list as Record<string, unknown>[]).map((s) => ({
    id: Number(s.id),
    name: String(s.name ?? ""),
    content: String(s.content ?? ""),
    folder: (s.folder as string | null) ?? null,
  }));
}

function errorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { error?: string } } })?.response?.data
      ?.error || fallback
  );
}

async function load(api: PluginApiClient, userId: string) {
  return mapSnippets((await api.get("/", adminOptions(userId))).data);
}

/** The Snippets tab of the admin "manage user" panel. */
export function AdminUserSnippets({
  user,
}: {
  user: { id: string; username: string };
}) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const { confirmWithToast } = useConfirmation();
  const [snippets, setSnippets] = useState<ManagedSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ManagedSnippet | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "", folder: "" });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    load(api, user.id)
      .then(setSnippets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, user.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save() {
    if (!form.name.trim() || !form.content.trim()) {
      toast.error(t("admin.requiredFields"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        content: form.content,
        folder: form.folder.trim() || null,
      };
      if (editing && editing !== "new") {
        await api.put(`/${editing.id}`, payload, adminOptions(user.id));
      } else {
        await api.post("/", payload, adminOptions(user.id));
      }
      setEditing(null);
      reload();
      toast.success(t("admin.saved"));
    } catch (error) {
      toast.error(errorMessage(error, t("admin.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  function remove(snippet: ManagedSnippet) {
    confirmWithToast(
      t("admin.deleteConfirm", { name: snippet.name, username: user.username }),
      async () => {
        try {
          await api.delete(`/${snippet.id}`, adminOptions(user.id));
          setSnippets((prev) => prev.filter((s) => s.id !== snippet.id));
          toast.success(t("admin.deleted"));
        } catch (error) {
          toast.error(errorMessage(error, t("admin.deleteFailed")));
        }
      },
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between py-2 border-b border-border">
        <span className="text-[10px] text-muted-foreground">
          {t("admin.count", { count: snippets.length })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={reload}
          >
            <RefreshCw className="size-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={() => {
              setForm({ name: "", content: "", folder: "" });
              setEditing("new");
            }}
          >
            <Plus className="size-3" />
            {t("admin.add")}
          </Button>
        </div>
      </div>
      {editing && (
        <div className="flex flex-col gap-2.5 py-3 border-b border-border">
          <Input
            className="h-8 text-xs"
            placeholder={t("admin.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <textarea
            rows={4}
            placeholder={t("admin.contentPlaceholder")}
            value={form.content}
            onChange={(e) =>
              setForm((p) => ({ ...p, content: e.target.value }))
            }
            className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          <Input
            className="h-8 text-xs"
            placeholder={t("admin.folderPlaceholder")}
            value={form.folder}
            onChange={(e) => setForm((p) => ({ ...p, folder: e.target.value }))}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={save}
            >
              {saving ? t("admin.saving") : t("admin.save")}
            </Button>
          </div>
        </div>
      )}
      {!loading && snippets.length === 0 && !editing && (
        <span className="text-xs text-muted-foreground py-3">
          {t("admin.empty")}
        </span>
      )}
      {snippets.map((snippet) => (
        <div
          key={snippet.id}
          className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-semibold truncate max-w-[180px]">
              {snippet.name}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[220px]">
              {snippet.content}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setForm({
                  name: snippet.name,
                  content: snippet.content,
                  folder: snippet.folder ?? "",
                });
                setEditing(snippet);
              }}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => remove(snippet)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
