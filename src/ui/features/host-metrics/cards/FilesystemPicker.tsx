import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DiskFilesystem } from "@/main-axios";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/dropdown-menu";

export function FilesystemPicker({
  filesystems,
  value,
  onChange,
  align = "end",
  className,
}: {
  filesystems: DiskFilesystem[];
  value: string | null;
  onChange: (mount: string) => void;
  align?: "start" | "end";
  className?: string;
}) {
  const { t } = useTranslation();

  if (filesystems.length <= 1) return null;

  const selected = filesystems.find((fs) => fs.mount === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex max-w-[160px] items-center gap-1 border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
        title={t("hostMetrics.selectFilesystem")}
      >
        <span className="truncate">{selected?.mount ?? value ?? "-"}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-auto min-w-[220px] max-w-[min(360px,calc(100vw-2rem))]"
      >
        {filesystems.map((fs) => (
          <DropdownMenuItem
            key={fs.mount}
            onSelect={() => onChange(fs.mount)}
            className="gap-3"
          >
            <Check
              className={cn(
                "size-3 shrink-0",
                fs.mount === value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {fs.mount}
            </span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              {fs.usedHuman && fs.totalHuman
                ? `${fs.usedHuman}/${fs.totalHuman}`
                : "N/A"}
              {fs.percent != null ? ` · ${fs.percent}%` : ""}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
