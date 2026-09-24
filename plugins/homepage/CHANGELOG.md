# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Homepage and the dashboard's service links moved out of core's own
  servers on ports 30006 (dashboard) and 30012 (homepage), and now serve
  under `/plugin-api/homepage`.
- Owns its data: core's `homepage_items`, `homepage_layouts` and
  `dashboard_service_links` tables are renamed to `p_homepage_*` on first
  activation.
- The favicon, RSS, ping and custom-API outbound requests now go through
  `ctx.fetch` instead of a raw fetch, keeping the same SSRF guard.
- New `homepage.use` permission, given to the admin and user roles.
- Offers `homepage.items` v1 to other plugins; the AI assistant reads it
  optionally.
- The dashboard's "Dashboard / Homepage" toggle is now a contribution to
  core's generic `dashboard.secondaryView` slot rather than a hardcoded
  homepage case.
- Core's uptime, recent-activity and database-health routes stayed on the
  main server, now under `/dashboard` rather than a dedicated port.
