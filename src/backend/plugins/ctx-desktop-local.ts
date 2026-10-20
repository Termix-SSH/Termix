/**
 * ctx.desktop.local: the user's own machine, behind desktop:local.
 *
 * Only works on the desktop app's embedded backend. On a server every call
 * throws, and available() is false. Path rules live in desktop-local/local-fs.
 */

import type {
  PluginDesktopLocal,
  PluginLocalPty,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import type { DisposableBag } from "./disposables.js";
import * as localFs from "./desktop-local/local-fs.js";
import { remoteJson, requestHeaders } from "../sync/client/http.js";
import { spawnLocalPty } from "./desktop-local/local-pty.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
  audit: AuditFn;
}

function isEmbedded(): boolean {
  return process.env.ELECTRON_EMBEDDED === "true";
}

export function createPluginDesktopLocal(deps: Deps): PluginDesktopLocal {
  const { manifest, bag, audit } = deps;
  const audited = new Set<string>();

  const guard = async (action: string, details: string, every = false) => {
    await assertCapability(
      manifest.id,
      "desktop:local",
      manifest.capabilities,
      action,
    );
    if (!isEmbedded()) {
      throw new Error(
        `Plugin ${manifest.id} used the local machine outside the desktop app`,
      );
    }
    if (every || !audited.has(action)) {
      audited.add(action);
      await audit(action, details, { success: true });
    }
  };

  const mainRequest = async (channel: string, path: string) => {
    const { requestFromElectronMain } =
      await import("../utils/electron-ipc-bridge.js");
    return requestFromElectronMain<{ success: boolean; error?: string }>(
      channel,
      { path },
    );
  };

  return {
    available: () =>
      isEmbedded() && manifest.capabilities.includes("desktop:local"),

    pluginFetch: async (origin, subPath, init) => {
      await guard("desktop_local_fetch", "called its own routes");
      if (
        typeof subPath !== "string" ||
        !subPath.startsWith("/") ||
        subPath.startsWith("//") ||
        subPath.includes("\\") ||
        /(^|\/)\.\.?(\/|\?|$)/.test(subPath)
      ) {
        throw new Error("Invalid plugin route path");
      }
      const route = `/plugin-api/${manifest.id}${subPath}`;
      const headers: Record<string, string> = { ...init?.headers };
      for (const name of Object.keys(headers)) {
        if (/^(authorization|cookie|host)$/i.test(name)) delete headers[name];
      }
      if (origin === "remote") {
        const { getLink } = await import("../sync/client/link-store.js");
        const link = await getLink();
        if (!link) throw new Error("This device is not linked to a server");
        const { remoteStreamFetch } = await import("../sync/client/http.js");
        return (await remoteStreamFetch(link, route, {
          method: init?.method,
          headers,
          body: init?.body,
          signal: init?.signal,
        })) as never;
      }
      if (origin !== "local") throw new Error("Unknown origin");
      const { getActor } = await import("./actor.js");
      const actor = getActor();
      if (!actor) throw new Error("No acting user");
      const { AuthManager } = await import("../utils/auth-manager.js");
      const session = await AuthManager.getInstance().issuePluginSession(
        actor,
        {
          pluginId: manifest.id,
          purpose: "desktop local transfer",
          ttlSeconds: 900,
        },
      );
      const port = Number(process.env.EMBEDDED_BACKEND_PORT) || 30001;
      const { fetch: undiciFetch } = await import("undici");
      return (await undiciFetch(`http://127.0.0.1:${port}${route}`, {
        method: init?.method ?? "GET",
        headers: {
          ...headers,
          "X-Electron-App": "true",
          Authorization: `Bearer ${session.token}`,
        },
        body: init?.body as never,
        duplex: "half",
        signal: init?.signal,
      } as never)) as never;
    },

    info: async () => {
      await guard("desktop_local_info", "read local machine info");
      const home = await localFs.homeInfo();
      const { getLink } = await import("../sync/client/link-store.js");
      const link = await getLink();
      return {
        ...home,
        userDataDir: process.env.ELECTRON_USER_DATA ?? "",
        backendPort: Number(process.env.EMBEDDED_BACKEND_PORT) || 30001,
        link: link
          ? {
              serverUrl: link.serverUrl,
              token: link.sessionToken,
              headers: requestHeaders(link),
              allowInvalidCertificate: !!link.allowInvalidCertificate,
            }
          : null,
      };
    },

    linkJson: async (pathname) => {
      await guard("desktop_local_link", "called the linked server");
      const { getLink } = await import("../sync/client/link-store.js");
      const link = await getLink();
      if (!link)
        throw new Error("This device is not linked to a Termix server");
      if (!pathname.startsWith("/")) throw new Error("Invalid path");
      return remoteJson(
        {
          serverUrl: link.serverUrl,
          sessionToken: link.sessionToken,
          customHeaders: link.customHeaders,
          basicAuth: link.basicAuth,
          allowInvalidCertificate: link.allowInvalidCertificate,
          clientCert: link.clientCert,
        },
        pathname,
      );
    },

    fs: {
      list: async (dirPath) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.listDirectory(dirPath);
      },
      mkdir: async (parentPath, name) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.makeDirectory(parentPath, name);
      },
      createFile: async (parentPath, name) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.createEmptyFile(parentPath, name);
      },
      rename: async (path, newName) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.renameEntry(path, newName);
      },
      ensureDir: async (dirPath, rootPath) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.ensureDirectory(dirPath, rootPath);
      },
      exists: async (paths) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.existingPaths(paths);
      },
      walk: async (rootPaths) => {
        await guard("desktop_local_fs", "used the local file system");
        if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
          throw new Error("No local paths provided");
        }
        return localFs.walkPaths(rootPaths);
      },
      trash: async (paths) => {
        await guard(
          "desktop_local_trash",
          `moved ${Array.isArray(paths) ? paths.length : 0} local items to the trash`,
          true,
        );
        if (!Array.isArray(paths) || paths.length === 0) {
          throw new Error("No local paths provided");
        }
        const failed: Array<{ path: string; error: string }> = [];
        for (const candidate of paths) {
          const target = localFs.normalizeLocalPath(candidate);
          try {
            const result = await mainRequest("shell-trash-item", target);
            if (!result?.success) throw new Error(result?.error ?? "Failed");
          } catch (error) {
            failed.push({
              path: target,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return { trashed: paths.length - failed.length, failed };
      },
      reveal: async (path) => {
        await guard("desktop_local_fs", "used the local file system");
        await mainRequest("shell-show-item", localFs.normalizeLocalPath(path));
      },
      open: async (path) => {
        await guard("desktop_local_open", "opened a local path", true);
        const result = await mainRequest(
          "shell-open-path",
          localFs.normalizeLocalPath(path),
        );
        if (!result?.success) throw new Error(result?.error ?? "Failed");
      },
      openRead: async (path) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.openRead(path);
      },
      openDownload: async (options) => {
        await guard("desktop_local_fs", "used the local file system");
        return localFs.openDownload(options);
      },
    },

    pty: {
      spawn: async (options) => {
        await guard("desktop_local_pty", "started a local shell", true);
        const child: PluginLocalPty = spawnLocalPty(options);
        // A shell never outlives the plugin that started it.
        bag.add(() => {
          try {
            child.kill();
          } catch {
            // already gone
          }
        });
        return child;
      },
    },
  };
}
