import { lazy, Suspense, type ComponentType } from "react";
import { Puzzle, type LucideProps } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { iconFileName } from "./frame-icons";

type Icon = ComponentType<LucideProps>;
type Loader = () => Promise<{ default: Icon }>;

const loaders = dynamicIconImports as unknown as Record<string, Loader>;
const made = new Map<string, Icon>();

function iconFor(name: string): Icon {
  const ready = made.get(name);
  if (ready) return ready;
  const load = Object.hasOwn(loaders, iconFileName(name))
    ? loaders[iconFileName(name)]
    : undefined;
  const icon = load ? (lazy(load) as unknown as Icon) : Puzzle;
  made.set(name, icon);
  return icon;
}

/**
 * The frame's PluginIcon. Same as the shell's, but it loads only the icon it
 * draws instead of every Lucide icon in each frame.
 */
export function PluginIcon({
  name,
  ...props
}: { name?: string } & LucideProps) {
  const Icon = name ? iconFor(name) : Puzzle;
  return (
    <Suspense
      fallback={<Puzzle {...props} style={{ ...props.style, opacity: 0 }} />}
    >
      <Icon {...props} />
    </Suspense>
  );
}
