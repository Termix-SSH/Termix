import { formatTransferMbPerSec } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine } from "lucide-react";
import { TransferProgressBar } from "./TransferProgressBar";

interface DownloadProgressToastProps {
  fileName: string;
  loaded: number;
  total?: number;
  mbPerSec?: number;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formattedSize} ${units[unitIndex]}`;
}

export function DownloadProgressToast({
  fileName,
  loaded,
  total,
  mbPerSec,
}: DownloadProgressToastProps) {
  const { t } = useTranslation();
  const percent =
    total !== undefined && total > 0
      ? Math.min(100, Math.round((loaded / total) * 100))
      : undefined;

  const speed = formatTransferMbPerSec(mbPerSec);

  return (
    <div className="flex w-[min(calc(100vw-5rem),288px)] max-w-full flex-col gap-2 pr-2">
      <p className="flex items-center gap-2 text-sm font-medium leading-tight">
        <ArrowDownToLine className="size-3.5 shrink-0 text-accent-brand" />
        <span className="truncate">
          {t("fileManager.downloadingFile", { name: fileName })}
        </span>
      </p>
      <TransferProgressBar
        value={percent}
        label={t("fileManager.downloadingFile", { name: fileName })}
      />
      <div className="flex items-center justify-between gap-3 pr-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {total !== undefined
            ? t("fileManager.downloadProgressBytes", {
                transferred: formatBytes(loaded),
                total: formatBytes(total),
              })
            : formatBytes(loaded)}
        </span>
        <span
          className={`shrink-0 tabular-nums ${speed ? "font-medium text-foreground" : "invisible"}`}
          aria-hidden={!speed}
        >
          {speed || "0 MB/s"}
        </span>
      </div>
    </div>
  );
}
