/* eslint-disable react-refresh/only-export-components */
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { pluginDocsPage } from "@termix-ssh/plugin-sdk/docs";
import { docsUrl, type DocsPage } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { usePluginScope } from "@/plugin-host/scope";
import { usePluginStore } from "@/plugin-host/plugin-store";

/** A plugin's docs link from its manifest, or null when it has none. */
export function usePluginDocsUrl(
  pluginId: string | null | undefined,
  page?: string,
  anchor?: string,
): string | null {
  const { records } = usePluginStore();
  const base = pluginId ? records.get(pluginId)?.summary.docs : undefined;
  return base ? pluginDocsPage(base, page, anchor) : null;
}

export interface DocsLinkProps {
  /** A core docs page. */
  core?: DocsPage;
  /**
   * A page of the current plugin's docs, like "setup". Inside a plugin this
   * resolves against its manifest docs link; "" is its main page.
   */
  page?: string;
  anchor?: string;
  /** A full URL, used as is. */
  href?: string | null;
  /** "text" is a small inline link, "icon" a square header button. */
  variant?: "text" | "icon";
  children?: ReactNode;
  className?: string;
}

/**
 * The one way the app links to docs. Renders nothing when there is nowhere
 * to go, like a community plugin with no docs link.
 */
export function DocsLink({
  core,
  page,
  anchor,
  href,
  variant = "text",
  children,
  className,
}: DocsLinkProps) {
  const { t } = useTranslation();
  const pluginId = usePluginScope();
  const pluginUrl = usePluginDocsUrl(
    page !== undefined ? pluginId : null,
    page,
    anchor,
  );
  const url =
    href ?? (core ? withAnchor(docsUrl(core), anchor) : null) ?? pluginUrl;
  if (!url) return null;

  const label = t("common.docs");
  if (variant === "icon") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        aria-label={label}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
          className,
        )}
      >
        <BookOpen className="size-3.5" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "shrink-0 text-[10px] text-accent-brand hover:underline",
        className,
      )}
    >
      {children ?? label}
    </a>
  );
}

function withAnchor(url: string, anchor?: string): string {
  if (!anchor) return url;
  return `${url.split("#")[0]}#${anchor.replace(/^#/, "")}`;
}
