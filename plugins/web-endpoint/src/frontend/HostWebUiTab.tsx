import { useEffect, useState } from "react";
import { resolveConnectionOrigin } from "@/lib/connection-origin";
import type { HostEditorForm, HostProtocols } from "@/sidebar/HostEditorData";
import { HostEditorWebUiSection } from "./HostEditorWebUiSection";

type SetHostField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

/**
 * Owns the async connection-origin resolution for the Web UI tab's tunnel
 * gate, then hands the resolved boolean to the presentational section.
 *
 * tunnelAvailable = enableSsh && originIsLocal. Deliberately NOT gated on
 * isElectron(): the forward binds wherever the backend runs, exactly as the
 * server tunnels feature does, and a web deployment reaches it at the host
 * serving Termix provided the endpoint opted out of a loopback bind. Gating
 * this on the desktop would be stricter than the tunnels feature it mirrors.
 *
 * connectionType is passed as "ssh" deliberately: a tunnel endpoint always
 * rides an SSH connection, and "ssh" keeps resolveConnectionOrigin out of its
 * RDP/VNC/Telnet guacamole special case, which always resolves to "remote".
 *
 * The origin state lives here rather than in HostEditor.tsx, which is already
 * very long; this follows HostEditorGeneralTab's precedent of taking
 * `protocols` as a prop and gating its own connection-origin control.
 *
 * Note the deliberate asymmetry with the sidebar: the sidebar entry appears on
 * enableWebUi alone, because a direct endpoint needs no SSH -- but Web UI is
 * an SSH sub-tab, so a host with SSH disabled cannot configure endpoints at
 * all. That is the accepted behaviour, not an oversight.
 */
export function HostWebUiTab({
  form,
  setField,
  protocols,
}: {
  form: HostEditorForm;
  setField: SetHostField;
  protocols: HostProtocols;
}) {
  const [originIsLocal, setOriginIsLocal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void resolveConnectionOrigin({
      connectionType: "ssh",
      connectionOrigin: form.connectionOrigin,
    }).then((origin) => {
      if (!cancelled) setOriginIsLocal(origin === "local");
    });
    return () => {
      cancelled = true;
    };
  }, [form.connectionOrigin]);

  return (
    <HostEditorWebUiSection
      enableWebUi={form.enableWebUi}
      webUiConfig={form.webUiConfig}
      tunnelAvailable={protocols.enableSsh && originIsLocal}
      setField={setField as (field: string, value: unknown) => void}
    />
  );
}
