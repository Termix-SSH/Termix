import type { FileItem, SSHHost } from "@/types/index";
import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ssh/dialogs/SSHAuthDialog.tsx";
import { WarpgateDialog } from "@/ssh/dialogs/WarpgateDialog.tsx";
import { PermissionsDialog } from "./components/PermissionsDialog.tsx";
import { CompressDialog } from "./components/CompressDialog.tsx";
import { SudoPasswordDialog } from "./SudoPasswordDialog.tsx";
import type { PendingSudoOperation } from "./file-manager-types.ts";

type FileManagerDialogsProps = {
  compressDialogFiles: FileItem[];
  setCompressDialogFiles: (files: FileItem[]) => void;
  handleCompress: (archiveName: string, format: string) => void | Promise<void>;
  totpRequired: boolean;
  totpPrompt: string;
  handleTotpSubmit: (code: string) => void | Promise<void>;
  handleTotpCancel: () => void;
  warpgateRequired: boolean;
  warpgateUrl: string;
  warpgateSecurityKey: string;
  handleWarpgateContinue: () => void | Promise<void>;
  handleWarpgateCancel: () => void;
  handleWarpgateOpenUrl: () => void;
  currentHost: SSHHost | null;
  showAuthDialog: boolean;
  authDialogReason: "no_keyboard" | "auth_failed" | "timeout";
  handleAuthDialogSubmit: (credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) => void | Promise<void>;
  handleAuthDialogCancel: () => void;
  permissionsDialogFile: FileItem | null;
  setPermissionsDialogFile: (file: FileItem | null) => void;
  handleSavePermissions: (
    file: FileItem,
    permissions: string,
  ) => void | Promise<void>;
  sudoDialogOpen: boolean;
  setSudoDialogOpen: (open: boolean) => void;
  setPendingSudoOperation: (operation: PendingSudoOperation | null) => void;
  handleSudoPasswordSubmit: (password: string) => void | Promise<void>;
};

export function FileManagerDialogs({
  compressDialogFiles,
  setCompressDialogFiles,
  handleCompress,
  totpRequired,
  totpPrompt,
  handleTotpSubmit,
  handleTotpCancel,
  warpgateRequired,
  warpgateUrl,
  warpgateSecurityKey,
  handleWarpgateContinue,
  handleWarpgateCancel,
  handleWarpgateOpenUrl,
  currentHost,
  showAuthDialog,
  authDialogReason,
  handleAuthDialogSubmit,
  handleAuthDialogCancel,
  permissionsDialogFile,
  setPermissionsDialogFile,
  handleSavePermissions,
  sudoDialogOpen,
  setSudoDialogOpen,
  setPendingSudoOperation,
  handleSudoPasswordSubmit,
}: FileManagerDialogsProps) {
  return (
    <>
      <CompressDialog
        open={compressDialogFiles.length > 0}
        onOpenChange={(open) => !open && setCompressDialogFiles([])}
        fileNames={compressDialogFiles.map((f) => f.name)}
        onCompress={handleCompress}
      />

      <TOTPDialog
        isOpen={totpRequired}
        prompt={totpPrompt}
        onSubmit={handleTotpSubmit}
        onCancel={handleTotpCancel}
        backgroundColor="var(--bg-canvas)"
      />

      <WarpgateDialog
        isOpen={warpgateRequired}
        url={warpgateUrl}
        securityKey={warpgateSecurityKey}
        onContinue={handleWarpgateContinue}
        onCancel={handleWarpgateCancel}
        onOpenUrl={handleWarpgateOpenUrl}
        backgroundColor="var(--bg-canvas)"
      />

      {currentHost && (
        <SSHAuthDialog
          isOpen={showAuthDialog}
          reason={authDialogReason}
          onSubmit={handleAuthDialogSubmit}
          onCancel={handleAuthDialogCancel}
          hostInfo={{
            ip: currentHost.ip,
            port: currentHost.port,
            username: currentHost.username,
            name: currentHost.name,
          }}
          backgroundColor="var(--bg-canvas)"
        />
      )}

      <PermissionsDialog
        file={permissionsDialogFile}
        open={permissionsDialogFile !== null}
        onOpenChange={(open) => {
          if (!open) setPermissionsDialogFile(null);
        }}
        onSave={handleSavePermissions}
      />

      <SudoPasswordDialog
        open={sudoDialogOpen}
        onOpenChange={(open) => {
          setSudoDialogOpen(open);
          if (!open) setPendingSudoOperation(null);
        }}
        onSubmit={handleSudoPasswordSubmit}
      />
    </>
  );
}
