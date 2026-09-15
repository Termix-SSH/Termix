// The embedded backend is a forked child process, so the only evidence the
// main process gets when it dies is whatever it wrote to stderr on the way
// out. A port conflict is by far the most common cause (a leftover backend
// from a hard-killed session, a Termix container bound to the same ports,
// or an unrelated service on 30001) and it is also the only one the user
// can actually act on, so it is classified separately from a generic crash
// and reported with the port that was taken.
//
// Every exit reaching here is a failure. Whether the child exited 0, was
// killed by a signal, or crashed makes no difference to the renderer: the
// backend process is gone, nothing restarts it, and retrying can never
// succeed. Only stopBackendServer() knows a shutdown was intentional, and
// it guards this call rather than encoding that verdict here -- an exit
// code cannot distinguish "we asked for this" from "something else killed
// it", and treating a clean-looking exit as benign would leave the
// renderer waiting forever, which is the failure this classification
// exists to prevent.

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
 * Classifies why the embedded backend process ended, from the tail of its
 * stderr. Always returns a failure -- see the note above on why every exit
 * that reaches this point counts as one.
 */
function classifyBackendFailure(stderr = "") {
  if (stderr.includes("EADDRINUSE")) {
    return { reason: "port-in-use", port: parseConflictingPort(stderr) };
  }

  return { reason: "crashed", port: null };
}

module.exports = { classifyBackendFailure };
