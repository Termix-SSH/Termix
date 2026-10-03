import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { aiApp } from "../app-ref";
import type { AgentAttachment, AgentSession } from "../../backend/agents/types";
import type { SessionActions } from "./AgentComposer";

export function Attachments({
  session: s,
  busy,
  action,
  onUpdated,
  selected,
  onSelected,
  children,
}: SessionActions & {
  children: ReactNode;
  selected: string[];
  onSelected: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  async function attach(body: unknown) {
    const result = await aiApp().api.post<AgentAttachment>(
      `/agents/${s.id}/workspace`,
      body,
    );
    onSelected([...selected, result.data.id]);
    onUpdated((await aiApp().api.get<AgentSession>(`/agents/${s.id}`)).data);
  }
  async function upload(file: File) {
    if (selected.length >= 4 || file.size > 1024 * 1024)
      throw Error(t("agents.attachmentLimit"));
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await attach({ operation: "upload", name: file.name, data });
  }
  return (
    <div
      className="space-y-2"
      onPaste={(e) => {
        const image = Array.from(e.clipboardData.items)
          .find((i) => i.type.startsWith("image/"))
          ?.getAsFile();
        if (!image || busy) return;
        e.preventDefault();
        void action(() => upload(image));
      }}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={fileInput}
          className="hidden"
          type="file"
          aria-label={t("agents.upload")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void action(() => upload(file));
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || selected.length >= 4}
          onClick={() => fileInput.current?.click()}
        >
          {t("agents.upload")}
        </Button>
        <Input
          className="max-w-sm"
          aria-label={t("agents.remoteFile")}
          placeholder={t("agents.remoteFile")}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !path || selected.length >= 4}
          onClick={() =>
            void action(async () => {
              await attach({ operation: "reference", path });
              setPath("");
            })
          }
        >
          {t("agents.attach")}
        </Button>
      </div>
      <div
        tabIndex={0}
        role="group"
        aria-label={t("agents.pasteImage")}
        className="text-xs text-muted-foreground"
      >
        {t("agents.pasteImage")}
      </div>
      {!!s.attachments?.length && (
        <select
          className="max-w-full rounded border bg-background p-1 text-sm"
          aria-label={t("agents.attachments")}
          value=""
          disabled={busy || selected.length >= 4}
          onChange={(e) => {
            if (e.target.value && !selected.includes(e.target.value))
              onSelected([...selected, e.target.value]);
          }}
        >
          <option value="">{t("agents.attachments")}</option>
          {s.attachments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.size} B)
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-2">
        {selected.map((id) => (
          <Button
            key={id}
            size="sm"
            variant="outline"
            onClick={() => onSelected(selected.filter((x) => x !== id))}
          >
            {s.attachments?.find((a) => a.id === id)?.name} ×
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}
