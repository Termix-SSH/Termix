/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

/** One page of a list, with the page clamped to what exists. */
export function pageOf<T>(
  items: T[],
  page: number,
  size: number,
): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { rows: items.slice(at * size, at * size + size), page: at, pages };
}

/** Pages a list in memory. Goes back to the first page when `reset` changes. */
export function usePaged<T>(items: T[], size: number, reset?: unknown) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [reset]);
  return { ...pageOf(items, page, size), setPage };
}

/** Previous and Next under a list. Hidden when there is only one page. */
export function Pager({
  page,
  pages,
  hasNext,
  onPage,
  className,
}: {
  page: number;
  /** Total pages when known; leave out for a list read a page at a time. */
  pages?: number;
  hasNext?: boolean;
  onPage: (next: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const next = hasNext ?? (pages !== undefined && page < pages - 1);
  if (page === 0 && !next) return null;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        {t("panel.pager.previous")}
      </Button>
      <span>
        {pages !== undefined
          ? t("panel.pager.pageOf", { page: page + 1, pages })
          : t("panel.pager.page", { page: page + 1 })}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={!next}
        onClick={() => onPage(page + 1)}
      >
        {t("panel.pager.next")}
      </Button>
    </div>
  );
}
