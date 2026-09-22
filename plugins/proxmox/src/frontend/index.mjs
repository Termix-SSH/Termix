/**
 * Frontend half of the proxmox plugin.
 *
 * Unlike ssh-terminal/docker, proxmox has no rail tab or standalone view —
 * only a discovery dialog (opened imperatively from HostsPanel.tsx, not
 * through a tab seam) and a host-editor settings tab. Registers the
 * host-editor tab through the same registerHostEditorTab seam docker uses.
 *
 * HostProxmoxTab itself stays in src/ui/sidebar/HostEditorFeatureTabs.tsx
 * rather than moving into this plugin: it takes the same {form, setField}
 * pair every other host editor tab does, and those types (HostEditorForm,
 * the setField signature) are core types HostEditor.tsx owns, the same
 * reason ssh-terminal leaves session-manager.ts in core rather than copying
 * it here.
 *
 * register() is called when the plugin is enabled, unregister() when it is
 * disabled. As of this change neither is actually invoked anywhere yet --
 * see plugins/ssh-terminal/frontend/index.mjs and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet" for the frontend half. This file follows
 * the same shape so it is ready the moment that loader exists. The dialog
 * is reached today through a direct import in HostsPanel.tsx, not through
 * this seam.
 */

export const id = "proxmox";
export const hostEditorTabId = "proxmox";

export async function register({ registerHostEditorTab, icons }) {
  if (registerHostEditorTab) {
    const { HostProxmoxTab } =
      await import("../../../../src/ui/sidebar/HostEditorFeatureTabs.tsx");
    registerHostEditorTab({
      id: hostEditorTabId,
      labelKey: "hosts.tabProxmox",
      icon: icons.Server,
      component: HostProxmoxTab,
    });
  }
}

export async function unregister({ unregisterHostEditorTab }) {
  unregisterHostEditorTab?.(hostEditorTabId);
}
