import type { ReactElement } from "react";
import { icons, type LucideIcon } from "lucide-react";
import { decodeIconValue } from "@/plugin-frame/frame-icons";

const byName = (name: string) =>
  icons[name as keyof typeof icons] as LucideIcon | undefined;

/** A plugin's wire icon in the shell, which has every Lucide icon. */
export function decodeHostIconValue(
  value: unknown,
): LucideIcon | ReactElement | undefined {
  return decodeIconValue(value, byName);
}
