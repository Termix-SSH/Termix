# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Runs entirely through the plugin SDK: no imports from Termix core.
- Connects through Termix's one SSH pipeline, so TOTP, Warpgate, jump hosts
  and proxies behave the same as in the terminal. A wrong TOTP code asks
  again instead of ending the connect.
- Each host's Docker switch and container runtime are this plugin's host
  settings now, moved over on upgrade. The host editor shows them in the
  Plugins tab.
- The API lives at `/plugin-api/docker/` and the console at
  `/plugin-ws/docker/console`. Disabling the plugin closes open consoles and
  enabling it again works without a restart.
- New `docker.use` permission, given to the admin and user roles.
- Provides `docker.containers` (list containers, start, stop and the rest)
  and `docker.events` (container state changes) for other plugins, which
  Automations uses for its Docker step and trigger.
- The Docker homepage widget comes from this plugin.
- Downloaded logs are the plain log text.
