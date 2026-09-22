/**
 * Frontend half of the web-endpoint plugin.
 *
 * Registers the endpoint viewer tab through the existing registerTabComponent
 * seam the same way network-topology's frontend does.
 *
 * HostEditorWebUiSection stays in src/ui/sidebar/ rather than moving here, and
 * is not registered through registerHostEditorTab: it is a section inside the
 * host editor's existing General tab, not a tab of its own, and it takes the
 * same {form, setField} pair every other host editor field does -- those types
 * (HostEditorForm, the setField signature) are core types HostEditor.tsx owns,
 * the same reason docker leaves HostDockerTab in core rather than copying it
 * into plugins/docker.
 *
 * register() is called when the plugin is enabled, unregister() when it is
 * disabled. As of this change neither is actually invoked anywhere yet -- see
 * src/ui/shell/pluginLoader.ts and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet" for the frontend half. Until one exists the
 * tab is rendered directly by tabUtils.tsx and merely gated on the plugin's
 * enabled state through BUILT_IN_TABS_BY_PLUGIN. This file follows the same
 * shape every other plugin's frontend entry does so it is ready the moment a
 * real loader lands.
 */

export const id = "web-endpoint";
export const tabId = "web-endpoint";

export async function register({ registerTabComponent }) {
  registerTabComponent?.(tabId, () =>
    import("./WebEndpointTab.tsx").then((m) => ({
      default: m.WebEndpointTab,
    })),
  );
}

export async function unregister({ unregisterTabComponent }) {
  unregisterTabComponent?.(tabId);
}
