import { useCallback, useEffect, useRef, useState } from "react";
import type { Host, HostFolder } from "@/types/ui-types";
import { getSSHFolders, getSSHHosts } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { buildHostTree } from "@/sidebar/build-host-tree";
import { setShellHosts } from "@/plugin-host/shell-bridge";

/** The saved hosts and their folder tree, kept fresh on change events. */
export function useHostList() {
  const [tree, setTree] = useState<HostFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [list, setList] = useState<Host[]>([]);
  const listRef = useRef(list);
  listRef.current = list;

  const reload = useCallback(async () => {
    try {
      const [raw, folders] = await Promise.all([
        getSSHHosts(),
        getSSHFolders().catch(() => []),
      ]);
      const converted = raw.map(sshHostToHost);
      setList(converted);
      const folderMeta = new Map<
        string,
        {
          color?: string;
          icon?: string;
          credentialId?: number | null;
          sortOrder?: number | null;
          localOnly?: boolean;
        }
      >();
      for (const f of folders) {
        folderMeta.set(f.name, {
          color: f.color ?? undefined,
          icon: f.icon ?? undefined,
          credentialId: f.credentialId ?? null,
          sortOrder: f.sortOrder ?? null,
          localOnly: !!f.localOnly,
        });
      }
      setTree(buildHostTree(raw, folderMeta));
    } catch {
      // Keep empty state on error
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onHostsChanged = () => {
      void reload();
    };
    window.addEventListener("termix:hosts-changed", onHostsChanged);
    window.addEventListener("ssh-hosts:changed", onHostsChanged);
    window.addEventListener("hosts:refresh", onHostsChanged);
    return () => {
      window.removeEventListener("termix:hosts-changed", onHostsChanged);
      window.removeEventListener("ssh-hosts:changed", onHostsChanged);
      window.removeEventListener("hosts:refresh", onHostsChanged);
    };
  }, [reload]);

  useEffect(() => {
    setShellHosts(list, loaded);
  }, [list, loaded]);

  return { list, listRef, tree, loading, loaded, reload };
}
