// termix:// links and --host arguments from the system. Main only checks
// their shape and hands them on; the renderer decides what they mean.

const SCHEME = "termix";
const MAX_LENGTH = 2048;

/** The link as a string when it is a termix:// link of a sane shape, or null. */
function parseLink(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/**
 * Links in a command line: a termix:// argument (what Windows and Linux
 * pass when a link opens the app) or --host=<id> from a shortcut, which is
 * turned into termix://host/<id>. A browser can only send the first kind,
 * so only --host counts as typed on this computer.
 */
function linksFromArgv(argv) {
  const links = [];
  for (const arg of Array.isArray(argv) ? argv : []) {
    if (typeof arg !== "string") continue;
    const host = /^--host=(\d{1,9})$/.exec(arg);
    if (host) {
      links.push({
        url: `${SCHEME}://host/${host[1]}`,
        source: "command-line",
      });
      continue;
    }
    const link = parseLink(arg);
    if (link) links.push({ url: link, source: "os-scheme" });
  }
  return links;
}

/**
 * Holds links until the window is ready, then sends each one. `send` posts
 * to the renderer; a link that arrives before it is up waits in the queue.
 */
function createLinkQueue() {
  const pending = [];
  let send = null;
  return {
    push(link) {
      if (!link) return;
      if (send) send(link);
      else if (pending.length < 20) pending.push(link);
    },
    /** The renderer asks once it listens; it gets what came before. */
    take() {
      return pending.splice(0, pending.length);
    },
    attach(next) {
      send = next;
    },
    detach() {
      send = null;
    },
  };
}

module.exports = { SCHEME, parseLink, linksFromArgv, createLinkQueue };
