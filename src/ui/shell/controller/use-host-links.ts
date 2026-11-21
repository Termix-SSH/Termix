import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { hostIdOf, onDeepLink, startDeepLinks } from "@/lib/deep-links";
import type { ConfirmOptions } from "@/components/surface/surface-scope";

// Each link opens a host once, even when a remount replays it.
const handled = new WeakSet<object>();

interface LinkHost {
  id: number | string;
  name?: string | null;
  ip?: string | null;
}

/**
 * termix://host/<id> and the --host=<id> shortcut open a saved host. A link
 * from anywhere else, like a web page, asks first; a shortcut on this
 * computer does not.
 */
export function useHostLinks<H extends LinkHost>({
  hostsRef,
  hostsLoaded,
  connectHost,
  confirmRef,
}: {
  hostsRef: MutableRefObject<H[]>;
  hostsLoaded: boolean;
  connectHost: (host: H) => void;
  confirmRef: MutableRefObject<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >;
}): void {
  const { t } = useTranslation();
  const connectRef = useRef(connectHost);
  connectRef.current = connectHost;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!hostsLoaded) return;
    startDeepLinks();
    return onDeepLink((link) => {
      const id = hostIdOf(link.url);
      if (id === null || handled.has(link)) return;
      handled.add(link);
      const host = hostsRef.current.find((h) => Number(h.id) === id);
      if (!host) return;
      const open = () => connectRef.current(host);
      if (link.source === "command-line") {
        open();
        return;
      }
      const ask = confirmRef.current;
      if (!ask) return;
      void ask({
        title: tRef.current("hosts.openFromLink.title", {
          name: host.name || host.ip || `#${id}`,
        }),
        description: tRef.current("hosts.openFromLink.description"),
        confirmLabel: tRef.current("hosts.openFromLink.confirm"),
        destructive: false,
      }).then((ok) => {
        if (ok) open();
      });
    });
  }, [hostsLoaded, hostsRef, confirmRef]);
}
