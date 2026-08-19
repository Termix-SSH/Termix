import { getErrorMessage } from "../../lib/error-message.js";
import { useCallback, useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button.tsx";
import {
  downloadFile,
  listDirectory,
  parentPath,
  saveBlobAs,
  uploadFile,
  type RemoteFileEntry,
} from "./guacamole-filesystem.ts";

interface GuacamoleFileBrowserProps {
  filesystem: Guacamole.Object;
  allowUpload: boolean;
  allowDownload: boolean;
  pendingUploads: File[];
  onPendingUploadsHandled: () => void;
  onClose: () => void;
}

export function GuacamoleFileBrowser({
  filesystem,
  allowUpload,
  allowDownload,
  pendingUploads,
  onPendingUploadsHandled,
  onClose,
}: GuacamoleFileBrowserProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        setEntries(await listDirectory(filesystem, target));
      } catch (err) {
        setEntries([]);
        setError(getErrorMessage(err, t("guacamole.files.listFailed")));
      } finally {
        setLoading(false);
      }
    },
    [filesystem, t],
  );

  useEffect(() => {
    void refresh(path);
  }, [refresh, path]);

  const upload = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        setBusyName(file.name);
        try {
          await uploadFile(filesystem, path, file);
          toast.success(t("guacamole.files.uploaded", { name: file.name }));
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : t("guacamole.files.uploadFailed", { name: file.name }),
          );
        } finally {
          setBusyName(null);
        }
      }
      void refresh(path);
    },
    [filesystem, path, refresh, t],
  );

  // Files dropped on the display land here so they share the browser's current
  // directory rather than always going to the drive root.
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    onPendingUploadsHandled();
    if (!allowUpload) {
      toast.error(t("guacamole.files.uploadDisabled"));
      return;
    }
    void upload(pendingUploads);
  }, [pendingUploads, onPendingUploadsHandled, allowUpload, upload, t]);

  const download = useCallback(
    async (entry: RemoteFileEntry) => {
      setBusyName(entry.name);
      try {
        const { blob, filename } = await downloadFile(filesystem, entry.path);
        saveBlobAs(blob, filename);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t("guacamole.files.downloadFailed", { name: entry.name }),
        );
      } finally {
        setBusyName(null);
      }
    },
    [filesystem, t],
  );

  return (
    <div className="absolute right-2 top-2 bottom-2 z-30 flex w-80 flex-col rounded-sm border border-border bg-background/95 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="flex-1 truncate text-xs font-semibold">
          {t("guacamole.files.title")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={path === "/"}
          onClick={() => setPath(parentPath(path))}
          aria-label={t("guacamole.files.parent")}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {path}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => void refresh(path)}
          aria-label={t("guacamole.files.refresh")}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            {t("common.loading")}
          </p>
        )}
        {!loading && error && (
          <p className="px-2 py-3 text-[11px] text-red-500">{error}</p>
        )}
        {!loading && !error && entries.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            {t("guacamole.files.empty")}
          </p>
        )}
        {!loading &&
          !error &&
          entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted"
            >
              {entry.isDirectory ? (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                className="flex-1 truncate text-left text-[11px] disabled:opacity-60"
                disabled={!entry.isDirectory}
                onClick={() => entry.isDirectory && setPath(entry.path)}
              >
                {entry.name}
              </button>
              {!entry.isDirectory && allowDownload && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  disabled={busyName === entry.name}
                  onClick={() => void download(entry)}
                  aria-label={t("guacamole.files.download")}
                >
                  <Download className="size-3" />
                </Button>
              )}
            </div>
          ))}
      </div>

      {allowUpload && (
        <div className="border-t border-border px-2 py-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void upload(files);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={busyName !== null}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1 size-3" />
            {busyName !== null
              ? t("guacamole.files.uploading", { name: busyName })
              : t("guacamole.files.upload")}
          </Button>
        </div>
      )}
    </div>
  );
}
