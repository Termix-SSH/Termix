import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search, X } from "lucide-react";
import { HostManager } from "@/sidebar/HostManager";

export function CredentialsPanel({
  onEditingChange,
  active = true,
}: {
  onEditingChange?: (editing: boolean) => void;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [managerEditing, setManagerEditing] = useState(false);

  function handleEditingChange(editing: boolean) {
    setManagerEditing(editing);
    onEditingChange?.(editing);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {!managerEditing && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 shrink-0 border-b border-border/60">
          <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60 rounded-sm flex-1 min-w-0">
            <Search className="size-3 text-muted-foreground/60 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("credentials.searchCredentials")}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("host-manager:add-credential"),
              )
            }
            title={t("credentials.addCredential")}
            className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 border border-accent-brand/30 rounded-sm shrink-0 transition-colors"
          >
            <Plus className="size-3 shrink-0" />
            {t("credentials.addCredential")}
          </button>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        <HostManager
          hideListHeader
          externalSearch={managerEditing ? undefined : search}
          onEditingChange={handleEditingChange}
          active={active}
        />
      </div>
    </div>
  );
}
