import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KbdProps = ComponentProps<"span"> & {
  children: ReactNode;
};

export const Kbd = ({ className, children, ...props }: KbdProps) => (
  <span
    className={cn(
      "inline-flex select-none items-center rounded-md border px-2 py-1 text-[10px] font-mono font-medium relative",
      "bg-linear-to-b from-gray-100 to-gray-200 border-gray-300 shadow-[0_2px_0_#ccc,0_3px_2px_rgba(0,0,0,0.25)]",
      "dark:from-zinc-800 dark:to-zinc-900 dark:border-zinc-700 dark:shadow-[0_2px_0_#222,0_3px_2px_rgba(0,0,0,0.4)]",
      "dark:text-zinc-200",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

export type KbdKeyProps = ComponentProps<"span"> & {
  "aria-label"?: string;
  className?: string;
};

export const KbdKey = ({ className, children, ...props }: KbdKeyProps) => (
  <span
    className={cn(
      "px-1 py-px rounded-sm select-none text-[10px] font-mono font-medium bg-transparent",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

export type KbdSeparatorProps = ComponentProps<"span"> & {
  children?: ReactNode;
  className?: string;
};

export const KbdSeparator = ({
  className,
  children = "+",
  ...props
}: KbdSeparatorProps) => (
  <span
    className={cn(
      "text-muted-foreground/70 text-[10px] mx-0.5 select-none pointer-events-none",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
