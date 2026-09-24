# Changelog

## 1.0.0

Converted from core's `src/backend/hosts/serial.ts` and
`src/ui/features/serial/` in Termix 2.9.0. Its own port (30011) and nginx
blocks are gone; it now serves `/plugin-ws/serial/console` like every other
plugin.
