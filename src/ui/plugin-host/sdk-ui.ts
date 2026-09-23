/**
 * @termix/plugin-sdk/ui: the shell's components, for plugins.
 *
 * Everything exported here is public API. A plugin builds its UI from these
 * so it looks like the rest of the app and picks up theme changes, and it
 * receives the shell's own instances through the import map, never a copy.
 *
 * The list is deliberate. It covers what the bundled plugins use today: the
 * shadcn primitives, the composites for metrics, connection screens and
 * settings rows, and the contexts a connection surface needs. Adding to it is
 * a contract change; update ARCHITECTURE.md with it. Removing from it breaks
 * plugins.
 */

// Primitives
export * from "@/components/alert";
export * from "@/components/alert-dialog";
export * from "@/components/badge";
export * from "@/components/button";
export * from "@/components/card";
export * from "@/components/checkbox";
export * from "@/components/dialog";
export * from "@/components/dropdown-menu";
export * from "@/components/input";
export * from "@/components/label";
export * from "@/components/password-input";
export * from "@/components/select";
export * from "@/components/select2";
export * from "@/components/separator";
export * from "@/components/switch";
export * from "@/components/textarea";
export * from "@/components/tooltip";

// Composites
export * from "@/components/section-card";
export * from "@/components/metric-card";
export * from "@/components/charts";
export {
  CardGridCanvas,
  ColumnCountStepper,
} from "@/components/card-grid/CardGridCanvas";
export type * from "@/components/card-grid/types";
export { ConnectionScreen } from "@/components/connection/ConnectionScreen";
export * from "@/components/connection/connection-status";
export { SnippetVariablesDialog } from "@/components/SnippetVariablesDialog";
export {
  FullScreenAppWrapper,
  type FullScreenAppPhase,
} from "@/features/FullScreenAppWrapper";

// Connection surfaces
export {
  ConnectionLogProvider,
  useConnectionLog,
  useOptionalConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext";
export { TOTPDialog, type MFAPromptMode } from "@/ssh/dialogs/TOTPDialog";
export { SSHAuthDialog } from "@/ssh/dialogs/SSHAuthDialog";
export { WarpgateDialog } from "@/ssh/dialogs/WarpgateDialog";

// Design tokens: the colour swatches folders, workspaces and tags pick from.
export { FOLDER_COLORS } from "@/lib/theme";

// Shell context
export { useTabs, useTabsSafe } from "@/shell/TabContext";

// Slots: a plugin can offer places for other plugins to fill.
export { ActionSlot, ComponentSlot } from "@/shell/ActionSlot";
