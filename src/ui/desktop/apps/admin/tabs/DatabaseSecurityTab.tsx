import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isElectron } from "@/ui/main-axios.ts";
import { getBasePath } from "@/lib/base-path";

interface DatabaseSecurityTabProps {
  currentUser: {
    is_oidc: boolean;
  } | null;
}

export function DatabaseSecurityTab({
  currentUser,
}: DatabaseSecurityTabProps): React.ReactElement {
  const { t } = useTranslation();

  const [exportLoading, setExportLoading] = React.useState(false);
  const [importLoading, setImportLoading] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [exportPassword, setExportPassword] = React.useState("");
  const [showPasswordInput, setShowPasswordInput] = React.useState(false);
  const [importPassword, setImportPassword] = React.useState("");

  const requiresImportPassword = React.useMemo(
    () => !currentUser?.is_oidc,
    [currentUser?.is_oidc],
  );

  const requiresExportPassword = React.useMemo(
    () => !currentUser?.is_oidc,
    [currentUser?.is_oidc],
  );

  const handleExportDatabase = async () => {
    if (requiresExportPassword) {
      if (!showPasswordInput) {
        setShowPasswordInput(true);
        return;
      }

      if (!exportPassword.trim()) {
        toast.error(t("admin.passwordRequired"));
        return;
      }
    }

    setExportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as { configuredServerUrl?: string }).configuredServerUrl}/database/export`
        : isDev
          ? `http://localhost:30001/database/export`
          : `${window.location.protocol}//${window.location.host}${getBasePath()}/database/export`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(
          requiresExportPassword ? { password: exportPassword } : {},
        ),
      });

      if (response.ok) {
        const blob = await response.blob();
        const contentDisposition = response.headers.get("content-disposition");
        const filename =
          contentDisposition?.match(/filename="([^"]+)"/)?.[1] ||
          "termix-export.sqlite";

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast.success(t("admin.databaseExportedSuccessfully"));
        setExportPassword("");
        setShowPasswordInput(false);
      } else {
        const error = await response.json();
        if (error.code === "PASSWORD_REQUIRED") {
          toast.error(t("admin.passwordRequired"));
        } else {
          toast.error(error.error || t("admin.databaseExportFailed"));
        }
      }
    } catch {
      toast.error(t("admin.databaseExportFailed"));
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportDatabase = async () => {
    if (!importFile) {
      toast.error(t("admin.pleaseSelectImportFile"));
      return;
    }

    if (requiresImportPassword && !importPassword.trim()) {
      toast.error(t("admin.passwordRequired"));
      return;
    }

    setImportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as { configuredServerUrl?: string }).configuredServerUrl}/database/import`
        : isDev
          ? `http://localhost:30001/database/import`
          : `${window.location.protocol}//${window.location.host}${getBasePath()}/database/import`;

      const formData = new FormData();
      formData.append("file", importFile);
      if (requiresImportPassword) {
        formData.append("password", importPassword);
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const summary = result.summary;
          const imported =
            summary.sshHostsImported +
            summary.sshCredentialsImported +
            summary.fileManagerItemsImported +
            summary.dismissedAlertsImported +
            (summary.settingsImported || 0);
          const skipped = summary.skippedItems;

          const details = [];
          if (summary.sshHostsImported > 0)
            details.push(`${summary.sshHostsImported} SSH hosts`);
          if (summary.sshCredentialsImported > 0)
            details.push(`${summary.sshCredentialsImported} credentials`);
          if (summary.fileManagerItemsImported > 0)
            details.push(
              `${summary.fileManagerItemsImported} file manager items`,
            );
          if (summary.dismissedAlertsImported > 0)
            details.push(`${summary.dismissedAlertsImported} alerts`);
          if (summary.settingsImported > 0)
            details.push(`${summary.settingsImported} settings`);

          toast.success(
            `Import completed: ${imported} items imported${details.length > 0 ? ` (${details.join(", ")})` : ""}, ${skipped} items skipped`,
          );
          setImportFile(null);
          setImportPassword("");

          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          toast.error(
            `${t("admin.databaseImportFailed")}: ${result.summary?.errors?.join(", ") || "Unknown error"}`,
          );
        }
      } else {
        const error = await response.json();
        if (error.code === "PASSWORD_REQUIRED") {
          toast.error(t("admin.passwordRequired"));
        } else {
          toast.error(error.error || t("admin.databaseImportFailed"));
        }
      }
    } catch {
      toast.error(t("admin.databaseImportFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
      <h3 className="text-lg font-semibold">{t("admin.databaseSecurity")}</h3>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="p-4 border rounded-lg bg-surface">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-blue-500" />
              <h4 className="font-semibold">{t("admin.export")}</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.exportDescription")}
            </p>
            {showPasswordInput && requiresExportPassword && (
              <div className="space-y-2">
                <Label htmlFor="export-password">Password</Label>
                <PasswordInput
                  id="export-password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Enter your password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleExportDatabase();
                    }
                  }}
                />
              </div>
            )}
            <Button
              onClick={handleExportDatabase}
              disabled={exportLoading}
              className="w-full"
            >
              {exportLoading
                ? t("admin.exporting")
                : showPasswordInput && requiresExportPassword
                  ? t("admin.confirmExport")
                  : t("admin.export")}
            </Button>
            {showPasswordInput && requiresExportPassword && (
              <Button
                variant="outline"
                onClick={() => {
                  setShowPasswordInput(false);
                  setExportPassword("");
                }}
                className="w-full"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="p-4 border rounded-lg bg-surface">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-green-500" />
              <h4 className="font-semibold">{t("admin.import")}</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.importDescription")}
            </p>
            <div className="relative inline-block w-full mb-2">
              <input
                id="import-file-upload"
                type="file"
                accept=".sqlite,.db"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start text-left"
              >
                <span
                  className="truncate"
                  title={importFile?.name || t("admin.pleaseSelectImportFile")}
                >
                  {importFile
                    ? importFile.name
                    : t("admin.pleaseSelectImportFile")}
                </span>
              </Button>
            </div>
            {importFile && requiresImportPassword && (
              <div className="space-y-2">
                <Label htmlFor="import-password">Password</Label>
                <PasswordInput
                  id="import-password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Enter your password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleImportDatabase();
                    }
                  }}
                />
              </div>
            )}
            <Button
              onClick={handleImportDatabase}
              disabled={
                importLoading ||
                !importFile ||
                (requiresImportPassword && !importPassword.trim())
              }
              className="w-full"
            >
              {importLoading ? t("admin.importing") : t("admin.import")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
