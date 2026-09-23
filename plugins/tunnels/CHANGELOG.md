# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Tunnels moved out of core's own server on port 30003 and now serve under
  `/plugin-api/tunnels` and `/plugin-ws/tunnels`.
- Both SSH legs of a tunnel now go through core's connect pipeline, so a host
  with an unknown or changed host key is refused the same way every other
  connection refuses it.
- Owns its data: core's `c2s_tunnel_presets` table is renamed to
  `p_tunnels_presets` on first activation, and each host's tunnel switch and
  saved tunnels move into this plugin's host settings.
- New `tunnels.use` permission, given to the admin and user roles.
- Offers `tunnels.access` to other plugins, used by web-endpoint and
  automations. A tunnel that drops on its own emits
  `plugin.tunnels.tunnel_disconnected`.
