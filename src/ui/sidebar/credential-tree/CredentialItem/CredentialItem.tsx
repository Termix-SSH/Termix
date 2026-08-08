import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, Pencil, Pin, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import type { Credential } from "@/types/ui-types";
import type {
  CredentialDensity,
  CredentialTrayTrigger,
} from "@/types/credential-sidebar-preferences";

export function credentialMatchesQuery(cred: Credential, query: string) {
  return (
    cred.name.toLowerCase().includes(query) ||
    cred.username.toLowerCase().includes(query) ||
    cred.tags?.some((t) => t.toLowerCase().includes(query))
  );
}

/**
 * Per-density layout knobs, mirroring HOST_ITEM_DENSITY_TOKENS in
 * HostItem.tsx -- one implementation with a token lookup instead of two
 * parallel JSX trees, so a future tweak only has to be made once.
 */
const CREDENTIAL_ITEM_DENSITY_TOKENS = {
  comfortable: {
    rowPadding: "pl-2.5 pr-2 py-2",
    nameTextSize: "text-[13px]",
    showUsernameRow: true,
    showTagsRow: true,
  },
  compact: {
    rowPadding: "pl-2 pr-1.5 py-[5px]",
    nameTextSize: "text-[12px]",
    showUsernameRow: false,
    showTagsRow: false,
  },
} as const;

export function CredentialItem({
  cred,
  usedByCount = 0,
  termixIdLinked = false,
  query = "",
  stripeIndex = 0,
  isMenuOpen = false,
  onMenuOpenChange,
  isTrayOpen = false,
  onTrayOpenChange,
  onDragStart,
  onDragEnd,
  depth = 0,
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
  reorderMode = false,
  onReorderDrop,
  isReorderHovered = false,
  reorderHoverEdge = null,
  onReorderHoverChange,
  onDeploy,
  onEdit,
  onDelete,
}: {
  cred: Credential;
  usedByCount?: number;
  termixIdLinked?: boolean;
  query?: string;
  stripeIndex?: number;
  isMenuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  isTrayOpen?: boolean;
  onTrayOpenChange?: (open: boolean) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Nesting level when rendered in a flattened virtual list. */
  depth?: number;
  density?: CredentialDensity;
  trayTrigger?: CredentialTrayTrigger;
  showTags?: boolean;
  /** When true (manual sort mode), show above/below drop zones for reordering. */
  reorderMode?: boolean;
  onReorderDrop?: (position: "before" | "after") => void;
  /** Whether THIS row is the current reorder drop target -- lifted to the
   * parent tree so only one row can ever show the drop-indicator bar at a
   * time. See HostItem's identical prop for the full rationale. */
  isReorderHovered?: boolean;
  reorderHoverEdge?: "before" | "after" | null;
  onReorderHoverChange?: (edge: "before" | "after" | null) => void;
  onDeploy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const reorderEdge = isReorderHovered ? reorderHoverEdge : null;
  const isKey = cred.type === "key";
  const tokens = CREDENTIAL_ITEM_DENSITY_TOKENS[density];
  const isCompact = density === "compact";
  const isTouchOnly =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

  const alwaysShowTray = trayTrigger === "always";
  const actionsOnly = trayTrigger === "actionsOnly";
  const shouldUseClickTray =
    !alwaysShowTray && !actionsOnly && (trayTrigger === "click" || isTouchOnly);

  const depthStyle =
    depth > 0 ? ({ paddingLeft: depth * 12 } as const) : undefined;

  const trayButtonClass =
    "flex items-center justify-center size-6.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors";

  const connectionButtons = isKey ? (
    <>
      <button
        title={t("credentials.deploySSHKeyTitle")}
        onClick={(e) => {
          e.stopPropagation();
          onDeploy();
        }}
        className={trayButtonClass}
      >
        <Upload className="size-3.5" />
      </button>
      <button
        title={t("credentials.copyDeployCommand")}
        onClick={async (e) => {
          e.stopPropagation();
          const pubKey = cred.publicKey;
          if (!pubKey) {
            toast.error(t("credentials.noPublicKeyAvailable"));
            return;
          }
          const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
          const ok = await copyToClipboard(cmd);
          if (ok) toast.success(t("credentials.deployCommandCopied"));
          else toast.error(t("common.copyFailed"));
        }}
        className={trayButtonClass}
      >
        <Copy className="size-3.5" />
      </button>
    </>
  ) : null;

  const managementButtons = (
    <>
      <button
        title={t("credentials.editCredentialAction")}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className={trayButtonClass}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        title={t("credentials.deleteCredentialAction")}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`${trayButtonClass} hover:text-destructive`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </>
  );

  const trayOpenState = isTrayOpen || isMenuOpen;
  const trayVisibilityClass =
    alwaysShowTray || actionsOnly
      ? `overflow-hidden transition-all duration-150 ease-out ${trayOpenState || alwaysShowTray ? "max-h-[60px] opacity-100" : "max-h-0 opacity-0"}`
      : shouldUseClickTray
        ? `overflow-hidden transition-all duration-150 ease-out ${trayOpenState ? "max-h-[60px] opacity-100" : "max-h-0 opacity-0"}`
        : `overflow-hidden transition-all duration-150 ease-out max-h-0 opacity-0 group-hover:max-h-[60px] group-hover:opacity-100 ${isMenuOpen ? "!max-h-[60px] !opacity-100" : ""}`;

  return (
    <div
      draggable={!isTouchOnly}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={() => {
        onReorderHoverChange?.(null);
        onDragEnd?.();
      }}
      onDragOver={(e) => {
        if (!reorderMode || !onReorderDrop) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onReorderHoverChange?.(
          e.clientY - rect.top < rect.height / 2 ? "before" : "after",
        );
      }}
      onDrop={(e) => {
        if (!reorderMode || !onReorderDrop || !reorderEdge) return;
        e.preventDefault();
        e.stopPropagation();
        onReorderDrop(reorderEdge);
        onReorderHoverChange?.(null);
      }}
      style={depthStyle}
      className={`group relative flex items-stretch cursor-default select-none transition-colors hover:bg-muted/50 ${stripeIndex % 2 === 1 ? "bg-muted/15" : ""} ${isMenuOpen ? "bg-muted/50" : ""}`}
    >
      {reorderMode && reorderEdge && (
        <div
          className={`absolute inset-x-0 h-0.5 bg-accent-brand pointer-events-none z-10 ${reorderEdge === "before" ? "top-0" : "bottom-0"}`}
        />
      )}

      <div
        className={`flex flex-col flex-1 min-w-0 ${tokens.rowPadding} ${isCompact ? "" : "gap-1"}`}
      >
        {/* Name row */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`${tokens.nameTextSize} font-semibold truncate text-foreground leading-none tracking-tight`}
          >
            {cred.name}
          </span>
          <span
            className={`text-[9px] px-1 py-px font-bold border leading-none shrink-0 ${isKey ? "border-accent-brand/30 text-accent-brand" : "border-border/60 text-muted-foreground/60"}`}
          >
            {isKey ? t("credentials.keyBadge") : t("credentials.passwordBadge")}
          </span>
          {termixIdLinked && (
            <span className="text-[9px] px-1 py-px font-bold border leading-none shrink-0 border-accent-brand/30 text-accent-brand/70">
              {t("credentials.idBadge")}
            </span>
          )}
          {cred.pin && (
            <Pin className="size-2.5 text-accent-brand/50 shrink-0" />
          )}
          {!shouldUseClickTray && !actionsOnly && (
            <span className="text-[11px] text-muted-foreground/45 truncate leading-none ml-auto shrink-0 group-hover:hidden">
              {usedByCount > 0 ? `${usedByCount}h` : ""}
            </span>
          )}
          {(shouldUseClickTray || actionsOnly) && (
            <button
              title={
                isTrayOpen
                  ? t("credentials.collapseActions")
                  : t("credentials.expandActions")
              }
              onClick={(e) => {
                e.stopPropagation();
                onTrayOpenChange?.(!isTrayOpen);
              }}
              className="ml-auto flex items-center justify-center size-5 rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted-foreground/10 transition-colors shrink-0"
            >
              <ChevronRight
                className={`size-3 transition-transform duration-150 ${isTrayOpen ? "rotate-90" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Username row */}
        {tokens.showUsernameRow && (cred.username || usedByCount > 0) && (
          <span className="text-[11px] text-muted-foreground/60 truncate leading-none font-mono">
            {cred.username}
            {usedByCount > 0 && (
              <span className="text-muted-foreground/40">
                {cred.username ? " · " : ""}
                {usedByCount}h
              </span>
            )}
          </span>
        )}

        {/* Tag pills */}
        {showTags && cred.tags && cred.tags.length > 0 && (
          <div
            className={`flex items-center gap-1 min-w-0 overflow-hidden ${tokens.showTagsRow ? "" : "-mt-0.5"}`}
          >
            {cred.tags.slice(0, isCompact ? 2 : 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-[1px] bg-muted/60 text-muted-foreground/70 lowercase shrink-0 leading-[1.4]"
              >
                {tag}
              </span>
            ))}
            {cred.tags.length > (isCompact ? 2 : 4) && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                +{cred.tags.length - (isCompact ? 2 : 4)}
              </span>
            )}
          </div>
        )}

        {/* Connection buttons: permanent in "always"/"actionsOnly" modes, or shown once the chevron opens the tray in click mode */}
        {connectionButtons &&
          (alwaysShowTray ||
            actionsOnly ||
            (shouldUseClickTray && isTrayOpen)) && (
            <div className="flex items-center flex-wrap gap-1">
              {connectionButtons}
            </div>
          )}

        {/* Action tray */}
        <div className={trayVisibilityClass}>
          <div
            className={`flex flex-col gap-0.5 ${alwaysShowTray || actionsOnly || shouldUseClickTray ? "" : "pt-1.5"}`}
          >
            {connectionButtons &&
              !alwaysShowTray &&
              !actionsOnly &&
              !shouldUseClickTray && (
                <div className="flex items-center flex-wrap gap-0.5">
                  {connectionButtons}
                </div>
              )}
            <div
              className={`flex items-center gap-0.5 border-t border-border/30 ${alwaysShowTray || actionsOnly || shouldUseClickTray ? "pt-1.5" : "pt-1 mt-0.5"}`}
            >
              {managementButtons}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
