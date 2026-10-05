/* eslint-disable react-refresh/only-export-components */
import type React from "react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { GroupHeading, PANEL } from "@/components/panel-layout";
import { TabStrip } from "@/components/tab-strip";
import { cn } from "@/lib/utils";

export interface EditorNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Marks a section holding something that needs fixing. */
  error?: boolean;
}

export interface EditorNavBand {
  id: string;
  label: string;
  items: EditorNavItem[];
}

/** Which section is in view, and a way to jump to one. */
export function useScrollSpy(
  containerRef: RefObject<HTMLElement | null>,
  ids: string[],
): { active: string; scrollTo: (id: string) => void } {
  const [active, setActive] = useState(ids[0] ?? "");
  const idsKey = ids.join("|");
  // A jump scrolls past every section between; the spy waits it out.
  const lockUntil = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      if (Date.now() < lockUntil.current) return;
      const top = container.getBoundingClientRect().top;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = container.querySelector<HTMLElement>(
          `[data-section="${id}"]`,
        );
        if (!el) continue;
        if (el.getBoundingClientRect().top - top <= 24) current = id;
      }
      if (
        container.scrollHeight > container.clientHeight &&
        container.scrollTop + container.clientHeight >=
          container.scrollHeight - 8
      ) {
        current = ids[ids.length - 1] ?? current;
      }
      setActive(current);
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, idsKey]);

  return {
    active: ids.includes(active) ? active : (ids[0] ?? ""),
    scrollTo: (id: string) => {
      const container = containerRef.current;
      const el = container?.querySelector<HTMLElement>(
        `[data-section="${id}"]`,
      );
      if (!container || !el) return;
      lockUntil.current = Date.now() + 600;
      setActive(id);
      container.scrollTo?.({
        top:
          el.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          8,
        behavior: "smooth",
      });
    },
  };
}

/** Wraps a section so the nav can find it. */
export function EditorSection({
  id,
  label,
  showHeading = true,
  children,
}: {
  id: string;
  label?: string;
  showHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <section data-section={id} className={`flex flex-col ${PANEL.gap}`}>
      {showHeading && label && <GroupHeading title={label} className="pt-1" />}
      {children}
    </section>
  );
}

/**
 * Mounts its children the first time they scroll near view, so a long editor
 * does not start every section's requests at once.
 */
export function LazySection({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useLayoutEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);
  return (
    <div ref={ref} className={shown ? "contents" : "min-h-24"}>
      {shown && children}
    </div>
  );
}

/**
 * An editor laid out like the settings screen: a section nav beside one
 * scrolling form, and the actions pinned under it.
 */
export function EditorPane({
  bands,
  banner,
  footer,
  errorCount = 0,
  revealRef,
  children,
  className,
}: {
  bands: EditorNavBand[];
  /** Filled with a function that scrolls a section into view. */
  revealRef?: React.MutableRefObject<((id: string) => void) | null>;
  /** Sits above the form, inside the scroll area. */
  banner?: ReactNode;
  /** Usually Cancel and Save, pinned at the bottom. */
  footer?: ReactNode;
  /** Shown beside the footer so a problem in a hidden section is not missed. */
  errorCount?: number;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const ids = bands.flatMap((band) => band.items.map((item) => item.id));
  const { active, scrollTo } = useScrollSpy(scrollRef, ids);
  const showNav = ids.length > 1;
  if (revealRef) revealRef.current = scrollTo;

  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      {showNav && (
        <nav
          aria-label={t("manage.sections")}
          className="hidden w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border py-2.5 thin-scrollbar lg:flex"
        >
          {bands.map((band) => (
            <div key={band.id} className="flex flex-col">
              <GroupHeading title={band.label} className="px-2.5 pb-1.5" />
              {band.items.map((item) => {
                const on = item.id === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => scrollTo(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-l-2 py-1.5 pl-2 pr-2 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring",
                      on
                        ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {item.icon && (
                      <span className="flex shrink-0 [&_svg]:size-3.5">
                        {item.icon}
                      </span>
                    )}
                    <span className="truncate text-xs font-medium">
                      {item.label}
                    </span>
                    {item.error && (
                      <span
                        title={t("manage.sectionNeedsAttention")}
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {showNav && (
          <div className="shrink-0 border-b border-border px-1 lg:hidden">
            <TabStrip
              tabs={bands.flatMap((band) =>
                band.items.map((item) => ({ id: item.id, label: item.label })),
              )}
              activeTab={active}
              onTabChange={scrollTo}
            />
          </div>
        )}
        <div
          ref={scrollRef}
          className={`min-h-0 flex-1 overflow-y-auto thin-scrollbar ${PANEL.body}`}
        >
          <div className={`mx-auto flex max-w-3xl flex-col ${PANEL.gap} pb-6`}>
            {banner}
            {children}
          </div>
        </div>
        {(footer || errorCount > 0) && (
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2">
            {errorCount > 0 && (
              <span className="text-[10px] text-destructive">
                {t("manage.needsAttention", { count: errorCount })}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
}
