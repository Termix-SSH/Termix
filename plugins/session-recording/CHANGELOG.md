# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Session recording moved out of core's `/session_logs` routes and now serves
  under `/plugin-api/session-recording` through core's connect pipeline.
- Owns its data: core's `session_recordings` table is renamed to
  `p_session_recording_session_recordings` on first activation.
- New `session-recording.view` permission, given to the admin and user roles.
- Offers `recordings.writer` to other plugins: `open()`/`append()`/`persist()`
  for an incremental writer (ssh-terminal), `createFinished()` for a recording
  already written to disk (remote desktop's guacd recordings).
- Retention days becomes an admin plugin setting; per-host recording becomes
  a host plugin setting.
