import { icons, type LucideProps } from "lucide-react";
import { Puzzle } from "lucide-react";

/**
 * A manifest names its icon as a Lucide component name ("Sparkles").
 *
 * An unknown or missing name falls back to a generic plugin glyph rather than
 * rendering nothing, so a plugin shipping a typo still gets a row an admin can
 * read.
 */
export function PluginIcon({
  name,
  ...props
}: { name?: string } & LucideProps) {
  const Icon = (name && icons[name as keyof typeof icons]) || Puzzle;
  return <Icon {...props} />;
}
