// The embedded backend is a forked child process, so the only evidence the
// main process gets when it dies is an exit code plus whatever it wrote to
// stderr on the way out. A port conflict is by far the most common cause
// (a leftover backend from a hard-killed session, a Termix container bound
// to the same ports, or an unrelated service on 30001) and it is also the
// only one the user can actually act on, so it is classified separately
// from a generic crash and reported with the port that was taken.

const SIGNALS_MEANING_DELIBERATE_SHUTDOWN = new Set(["SIGTERM", "SIGINT"]);

function parseConflictingPort(stderr) {
  // Node's EADDRINUSE error prints the port twice: once inside the message
  // ("address already in use :::30001") and once as a numeric `port` field
  // on the error object. Either is enough, but stderr arrives in chunks and
  // the tail can be cut off, so both are tried.
  const fromErrorField = stderr.match(/\bport:\s*(\d{1,5})\b/);
  if (fromErrorField) return Number(fromErrorField[1]);

  const fromMessage = stderr.match(/address already in use\s+\S*?:(\d{1,5})\b/);
  if (fromMessage) return Number(fromMessage[1]);

  return null;
}

/**
 * Classifies why the embedded backend process ended.
 *
 * Returns null when nothing went wrong -- a clean exit, or a shutdown we
 * asked for -- and otherwise the reason the renderer should surface instead
 * of waiting forever for a backend that is never coming back.
 */
function classifyBackendFailure({ exitCode, signal = null, stderr = "" }) {
  if (exitCode === 0) return null;
  if (exitCode === null && SIGNALS_MEANING_DELIBERATE_SHUTDOWN.has(signal)) {
    return null;
  }

  if (stderr.includes("EADDRINUSE")) {
    return { reason: "port-in-use", port: parseConflictingPort(stderr) };
  }

  return { reason: "crashed", port: null };
}

module.exports = { classifyBackendFailure };
