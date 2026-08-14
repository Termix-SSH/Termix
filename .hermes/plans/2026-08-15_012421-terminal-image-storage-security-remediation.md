# Terminal Image Storage Security Remediation Plan

> **For Hermes:** Execute this plan milestone-by-milestone with strict TDD,
> Hoarder verification, independent review, and fail-closed deployment gates.

**Goal:** Close the council's security, correctness, resource, and regression
findings in the complete terminal image-storage fix before any deployment.

**Architecture:** Keep the existing Sharp normalization and explicit
local/remote/auto storage modes, but make terminal path handoff safe, make
remote storage private and bounded as far as the architecture permits, fail
closed on uncertain quota state, and verify every boundary with focused and
end-to-end tests. No live deployment changes are allowed until a second council
review passes.

**Tech Stack:** TypeScript, Express, Multer, Sharp/libvips, ssh2/SFTP, React,
Vitest, Docker, Hoarder remote-build.

---

## Safety boundaries

- Work only in `/home/niraj/Termix-image-storage-clean`.
- Do not modify `/home/niraj/Termix-toolbar-phase1`.
- Do not push, deploy, restart, or modify the live Termix container.
- Do not copy credentials, `.env` files, session state, or connection strings.
- Keep each accepted milestone in a separate commit.
- Use Hoarder for dependency installation, tests, builds, and Docker checks.
- Treat external reviewer output as hypotheses; verify every finding locally.
- Do not claim hard remote quota enforcement unless the implementation proves it.

## Council blockers to close

1. Raw `shellPath` is inserted into terminal input without shell-safe quoting.
2. Remote SFTP storage has no retention, cleanup, or effective quota policy.
3. Remote directory/files do not have explicit private permissions or isolation.
4. SFTP channels are not explicitly closed and writes lack a bounded timeout.
5. Authenticated uploads can create unbounded concurrent memory/CPU pressure.
6. Legacy `TERMIX_IMAGE_DIR`-only configuration is broken.
7. `localMappingConfigured` uses raw source presence instead of effective values.
8. Filesystem inspection failures fail open as an empty quota state.
9. Settings PATCH can persist partial state after returning an error.
10. SFTP existing-directory handling is server-message dependent.
11. Required authentication, multipart, format, concurrency, UI, and E2E tests
    are missing.

---

## Milestone 1: Safe terminal path handoff

**Scope:** `shellPath` construction and terminal insertion only.

**Files:**
- Modify: `src/ui/features/terminal/Terminal.tsx`
- Modify or create focused tests under `src/ui/tests/features/terminal/`
- Review: `src/backend/database/routes/terminal-image-storage-settings.ts`

### TDD steps

1. Add failing tests for host paths containing spaces and shell metacharacters.
2. Verify the tests fail because the inserted terminal input is unquoted.
3. Implement one safe path-handoff helper with explicit POSIX shell quoting.
4. Ensure fixed remote paths and local configured paths use the same safe path.
5. Run the focused UI tests and type-check.
6. Commit only this milestone as `fix: quote terminal image paths safely`.

**Acceptance:** No configured path can inject control characters or shell syntax
into terminal input; benign paths with spaces remain usable.

---

## Milestone 2: Remote SFTP lifecycle and privacy

**Scope:** Remote directory/file isolation, channel closure, and bounded writes.

**Files:**
- Modify: `src/backend/database/routes/terminal.ts`
- Modify: `src/backend/database/routes/terminal-image-storage.ts`
- Modify: `src/backend/database/routes/terminal-image-storage-settings.ts` if
  remote directory settings are required
- Test: `src/backend/tests/database/routes/terminal-image-storage.test.ts`
- Test: `src/backend/tests/database/routes/terminal-image-upload-route.test.ts`

### TDD steps

1. Add failing tests for SFTP channel close on success and failure.
2. Add failing tests for stalled SFTP writes timing out safely.
3. Add failing tests for restrictive directory/file mode requests.
4. Add failing tests for remote cleanup/retention behavior and explicit
   best-effort failure handling.
5. Implement the smallest adapter changes needed for cleanup and privacy.
6. Verify existing ssh2 API signatures before finalizing the abstraction.
7. Run focused backend tests, type-check, and build.
8. Commit as `fix: harden remote terminal image storage`.

**Acceptance:** Remote writes do not leak files through default permissions,
channels are closed in all paths, stalled writes fail safely, and retention
behavior is explicit and tested.

---

## Milestone 3: Upload resource and quota hardening

**Scope:** Input/output size, concurrency, and fail-closed filesystem behavior.

**Files:**
- Modify: `src/backend/database/routes/terminal.ts`
- Modify: `src/backend/database/routes/terminal-image-storage.ts`
- Test: `src/backend/tests/database/routes/terminal-image-upload-route.test.ts`
- Test: `src/backend/tests/database/routes/terminal-image-storage.test.ts`

### TDD steps

1. Add failing tests for normalized output-size rejection.
2. Add failing tests for concurrent large-upload admission limits.
3. Add failing tests proving `readdir`/`stat` errors do not undercount quota.
4. Implement bounded concurrency and consistent limits for local and remote.
5. Preserve stable public error codes and sanitized responses.
6. Run focused tests, type-check, lint, and build.
7. Commit as `fix: bound terminal image upload resources`.

**Acceptance:** Authenticated users cannot create unbounded simultaneous image
processing work; uncertain filesystem state fails closed; output limits apply
before remote writes.

---

## Milestone 4: Settings and compatibility correctness

**Scope:** Legacy mapping, effective-source precedence, atomic updates, TTL,
Auto-mode contract, and SFTP mkdir behavior.

**Files:**
- Modify: `src/backend/database/routes/terminal-image-storage-settings.ts`
- Modify: `src/backend/database/routes/user-image-storage-routes.ts`
- Modify: `src/backend/database/routes/terminal-image-storage.ts`
- Modify: `src/ui/sidebar/AdminImageStorageSection.tsx`
- Test: `src/backend/tests/database/routes/terminal-image-storage-settings.test.ts`
- Test: `src/backend/tests/database/routes/terminal-image-storage-settings-route.test.ts`
- Test: `src/backend/tests/database/routes/terminal-image-storage.test.ts`

### TDD steps

1. Add failing legacy directory-only and mixed DB/environment tests.
2. Add failing atomic PATCH failure test.
3. Add failing TTL boundary/zero behavior test.
4. Add failing generic-SFTP-directory-exists test.
5. Decide and document the authoritative Auto-mode contract.
6. Implement validated effective-pair resolution and transactional writes.
7. Run focused tests and update API/UI text to match behavior.
8. Commit as `fix: make image storage settings deterministic`.

**Acceptance:** Legacy behavior is preserved, effective settings are coherent,
failed saves do not partially apply, and UI/API/docs agree.

---

## Milestone 5: Boundary and regression test expansion

**Scope:** Tests that the council identified as absent.

**Files:**
- Modify: backend route/storage test files listed above
- Add: narrowly scoped UI tests for Admin Image Storage and clipboard handoff
- Add: multipart/auth integration coverage where the existing harness permits

### Required coverage

- Unauthenticated upload returns 401.
- Non-admin settings access returns 401/403.
- Multer size and malformed multipart behavior.
- Unsupported decoded format behavior.
- Auto fallback after local visibility failure.
- Explicit local/remote determinism.
- Remote permissions, cleanup, channel lifecycle, and write timeout.
- Concurrent uploads and quota boundaries.
- Clipboard PNG preservation and non-PNG conversion fallback.
- Draft-vs-saved Admin Test behavior.

Commit as `test: cover terminal image storage security boundaries`.

---

## Milestone 6: Verification and second council

Run on Hoarder:

```bash
corepack npm ci --ignore-scripts
corepack npm audit --omit=dev --audit-level=high
corepack npm test
corepack npm run type-check
corepack npm run lint
corepack npm run build
```

Then:

1. Inspect the complete diff and changed-file scope.
2. Run a fresh independent council using different provider/model routes.
3. Reconcile every finding against source and test evidence.
4. Commit only after security and logic findings are closed.
5. Update this plan with actual evidence and residual risks.

**Acceptance:** Production dependency audit is clean, all required checks pass,
and the independent council returns no unclosed security or correctness
blockers.

---

## Milestone 7: Disposable end-to-end acceptance

Only after Milestone 6 passes:

1. Build a disposable Docker image with the required architecture argument.
2. Start a disposable container and verify health.
3. Verify unauthenticated settings rejection.
4. Authenticate as a normal user and upload a known non-black PNG.
5. Verify clipboard PNG upload and terminal handoff.
6. Test malformed, SVG, oversized, and decompression-heavy inputs.
7. Exercise local, remote-SFTP, and Auto modes with a connected terminal.
8. Verify permissions, cleanup, quotas, safe error responses, and no unexpected
   command submission.
9. Remove all disposable containers, volumes, and images.

No live restart or deployment occurs in this milestone.

---

## Final deployment gate

Deployment requires explicit confirmation after all of the following are true:

- All P0/P1 findings are closed or explicitly accepted with documented risk.
- Second council review is clean.
- Hoarder verification passes.
- Disposable E2E acceptance passes.
- Live deployment identity, rollback image, and recovery path are recorded.
- A separate supervised deployment approval is given.
