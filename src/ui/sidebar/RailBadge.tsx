/**
 * The count a rail item shows on its icon. Each badge is its own component so
 * the item's useBadge hook runs once per render of a stable element.
 */
export function RailBadge({
  useBadge,
  variant = "count",
  className = "",
}: {
  useBadge: () => number | null | undefined;
  variant?: "count" | "dot";
  className?: string;
}) {
  const count = useBadge();
  if (!count || count <= 0) return null;
  if (variant === "dot") {
    return (
      <span
        className={`absolute size-1.5 rounded-full bg-accent-brand ${className}`}
      />
    );
  }
  return (
    <span
      className={`absolute min-w-[14px] h-[14px] px-[3px] rounded-full bg-accent-brand text-[9px] font-bold leading-[14px] text-center text-white tabular-nums ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
