# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Owns its data: core's `user_workspaces` table is renamed to
  `p_workspaces_workspaces` on first activation, keeping every saved workspace.
- New `workspaces.use` permission, given to the admin and user roles. Without
  it the rail item is hidden and the routes answer 403.
- Saved workspaces sync between the desktop app and a server. The per-device
  "Last Session" does not.
- Offers `workspaces.saved` to other plugins, used by the AI assistant.
- A tab from a plugin that is off is kept as a placeholder when a workspace is
  applied, instead of being dropped.
