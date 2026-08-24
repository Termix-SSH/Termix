import Guacamole from "guacamole-common-js";

// The root stream of a Guacamole.Object maps stream name to mimetype; a stream
// carrying that same mimetype is itself a directory.
export const STREAM_INDEX_MIMETYPE =
  "application/vnd.glyptodon.guacamole.stream-index+json";

export interface RemoteFileEntry {
  name: string;
  path: string;
  mimetype: string;
  isDirectory: boolean;
}

export function isDirectoryMimetype(mimetype: string): boolean {
  return mimetype === STREAM_INDEX_MIMETYPE;
}

export function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

export function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

// guacd returns absolute paths as keys, but a malformed or relative key would
// otherwise produce a broken path on the next descent.
export function parseDirectoryIndex(
  json: string,
  path: string,
): RemoteFileEntry[] {
  const index = JSON.parse(json) as Record<string, string>;

  return Object.entries(index)
    .map(([key, mimetype]) => {
      const name = basename(key);
      return {
        name,
        path: key.startsWith("/") ? key : joinPath(path, name),
        mimetype,
        isDirectory: isDirectoryMimetype(mimetype),
      };
    })
    .sort((a, b) =>
      a.isDirectory === b.isDirectory
        ? a.name.localeCompare(b.name)
        : a.isDirectory
          ? -1
          : 1,
    );
}

// A refused stream is answered with an error ack that never reaches the body
// callback, so every request needs its own deadline to avoid hanging forever.
const REQUEST_TIMEOUT_MS = 15000;

function requestStream(
  filesystem: Guacamole.Object,
  path: string,
): Promise<{ stream: Guacamole.InputStream; mimetype: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out reading ${path}`)),
      REQUEST_TIMEOUT_MS,
    );

    filesystem.requestInputStream(path, (stream, mimetype) => {
      clearTimeout(timeout);
      resolve({ stream, mimetype });
    });
  });
}

export async function listDirectory(
  filesystem: Guacamole.Object,
  path: string,
): Promise<RemoteFileEntry[]> {
  const { stream, mimetype } = await requestStream(filesystem, path);

  if (!isDirectoryMimetype(mimetype)) {
    throw new Error(`${path} is not a directory`);
  }

  const json = await new Promise<string>((resolve) => {
    const reader = new Guacamole.StringReader(stream);
    let text = "";
    reader.ontext = (chunk: string) => {
      text += chunk;
    };
    reader.onend = () => resolve(text);
  });

  return parseDirectoryIndex(json, path);
}

export async function downloadFile(
  filesystem: Guacamole.Object,
  path: string,
): Promise<{ blob: Blob; filename: string }> {
  const { stream, mimetype } = await requestStream(filesystem, path);

  if (isDirectoryMimetype(mimetype)) {
    throw new Error(`${path} is a directory`);
  }

  const blob = await new Promise<Blob>((resolve) => {
    const reader = new Guacamole.BlobReader(stream, mimetype);
    reader.onend = () => resolve(reader.getBlob());
  });

  return { blob, filename: basename(path) };
}

export function uploadFile(
  filesystem: Guacamole.Object,
  directory: string,
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const path = joinPath(directory, file.name);
    const stream = filesystem.createOutputStream(
      file.type || "application/octet-stream",
      path,
    );
    const writer = new Guacamole.BlobWriter(stream);

    // A rejected blob stops the writer without firing onerror or oncomplete —
    // only the error ack reports it, so without this the upload hangs forever.
    writer.onack = (status: Guacamole.Status) => {
      if (status.isError()) {
        reject(
          new Error(
            status.message || `Server refused the upload of ${file.name}`,
          ),
        );
      }
    };
    writer.onerror = () => reject(new Error(`Failed to upload ${file.name}`));
    writer.onprogress = (_blob: Blob, offset: number) =>
      onProgress?.(offset, file.size);
    writer.oncomplete = () => {
      writer.sendEnd();
      onProgress?.(file.size, file.size);
      resolve();
    };

    writer.sendBlob(file);
  });
}

export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Turns an upload failure into something a user can act on. guacd answers a
 * refused stream with an ack like "FAIL (CANNOT OPEN)" - accurate, but it
 * means "the drive folder isn't writable", which is what people need to hear.
 */
export function describeUploadError(
  error: unknown,
  t: (key: "driveNotWritable" | "driveUnavailable" | "uploadFailed") => string,
): string {
  const message = error instanceof Error ? error.message : "";
  if (/cannot open|can't open|permission denied/i.test(message)) {
    return t("driveNotWritable");
  }
  if (/no fs/i.test(message)) {
    return t("driveUnavailable");
  }
  return message || t("uploadFailed");
}
