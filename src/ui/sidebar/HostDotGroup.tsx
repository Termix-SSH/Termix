import { useCallback, useMemo, useState } from "react";
import { StatusDot } from "@/components/status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
import type { Host } from "@/types/ui-types";
import type { HostBadgeDef, HostDot } from "./host-contributions";

function DotSlot({
  badge,
  host,
  onDot,
}: {
  badge: HostBadgeDef;
  host: Host;
  onDot: (id: string, dot: HostDot | null) => void;
}) {
  const Reporter = badge.dot!;
  const report = useCallback(
    (dot: HostDot | null) => onDot(badge.id, dot),
    [badge.id, onDot],
  );
  return <Reporter host={host} report={report} />;
}

/**
 * The one status dot on a host row. Every badge that reports a dot feeds it,
 * so the worst tone wins and the tooltip lists each reason.
 */
export function HostDotGroup({
  host,
  badges,
  className,
}: {
  host: Host;
  badges: HostBadgeDef[];
  className?: string;
}) {
  const [dots, setDots] = useState<Record<string, HostDot | null>>({});
  const onDot = useCallback((id: string, dot: HostDot | null) => {
    setDots((current) => {
      const before = current[id];
      if (before?.tone === dot?.tone && before?.label === dot?.label)
        return current;
      return { ...current, [id]: dot };
    });
  }, []);
  const sources = badges.filter((badge) => badge.dot);
  const active = useMemo(
    () =>
      sources
        .map((badge) => dots[badge.id])
        .filter((dot): dot is HostDot => !!dot),
    [sources, dots],
  );
  const tone = active.some((dot) => dot.tone === "bad") ? "bad" : "warn";
  const lines = [
    ...new Set(active.map((dot) => dot.label).filter(Boolean)),
  ].join("\n");

  return (
    <>
      {sources.map((badge) => (
        <DotSlot key={badge.id} badge={badge} host={host} onDot={onDot} />
      ))}
      {active.length > 0 && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid="host-dot"
                className="flex shrink-0 items-center"
              >
                <StatusDot tone={tone} className={className} />
              </span>
            </TooltipTrigger>
            {lines && (
              <TooltipContent side="right" className="whitespace-pre-line">
                {lines}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
}
