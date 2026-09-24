# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Tmux monitoring moved out of core's own server on port 30010 and now serves
  under `/plugin-api/tmux-monitor` through core's connect pipeline.
- Owns its data: core's `tmux_session_tags` table is renamed to
  `p_tmux_monitor_session_tags` on first activation, and each host's monitor
  switch moves into this plugin's host settings.
- New `tmux-monitor.use` permission, given to the admin and user roles.
- Offers `tmux.sessions` to other plugins, so the terminal can attach to,
  create and wait for tmux sessions without importing this plugin.
