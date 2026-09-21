/**
 * Frontend half of the docker plugin.
 *
 * Registers the container-management tab through the existing extension
 * seams (registerRailItem / registerTabComponent) the same way
 * ssh-terminal's frontend does, and the host-editor Docker tab through the
 * new registerHostEditorTab seam built for this plugin.
 *
 * HostDockerTab itself stays in src/ui/sidebar/HostEditorFeatureTabs.tsx
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
 * the same shape so it is ready the moment that loader exists.
 */

export const id = "docker";
export const tabId = "docker";
export const hostEditorTabId = "docker";

export async function register({
  registerRailItem,
  registerTabComponent,
  registerHostEditorTab,
  icons,
}) {
  registerTabComponent(tabId, () =>
    import("./DockerManager.tsx").then((m) => ({
      default: m.DockerManager,
    })),
  );

  registerRailItem({
    id: tabId,
    icon: icons.Box,
    labelKey: "nav.docker",
    kind: "tab",
  });

  if (registerHostEditorTab) {
    const { HostDockerTab } = await import(
      "../../../src/ui/sidebar/HostEditorFeatureTabs.tsx"
    );
    registerHostEditorTab({
      id: hostEditorTabId,
      labelKey: "hosts.tabDocker",
      icon: icons.Box,
      component: HostDockerTab,
    });
  }
}

export async function unregister({
  unregisterRailItem,
  unregisterTabComponent,
  unregisterHostEditorTab,
}) {
  unregisterRailItem(tabId);
  unregisterTabComponent(tabId);
  unregisterHostEditorTab?.(hostEditorTabId);
}
