import type { SSHHost } from "@/types";

export interface JumpHostItemProps {
  jumpHost: { hostId: number };
  index: number;
  hosts: SSHHost[];
  editingHost?: SSHHost | null;
  onUpdate: (hostId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}

export interface QuickActionItemProps {
  quickAction: { name: string; snippetId: number };
  index: number;
  snippets: Array<{ id: number; name: string; content: string }>;
  onUpdate: (name: string, snippetId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}
