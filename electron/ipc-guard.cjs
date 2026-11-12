// Every IPC call from a renderer goes through here. Only the app's own page,
// in the main window's top frame, may call; the arguments are checked before
// the handler sees them. A bad call is refused, never passed through.

class IpcRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "IpcRefused";
  }
}

function refuse(message) {
  throw new IpcRefused(message);
}

function createIpcGuard({
  ipcMain,
  getMainWindow,
  isAppUrl,
  args = {},
  log = () => {},
}) {
  function allowed(event) {
    const main = getMainWindow();
    if (!main || main.isDestroyed?.()) return false;
    const frame = event?.senderFrame;
    if (!frame || frame !== main.webContents.mainFrame) return false;
    if (event.sender !== main.webContents) return false;
    return isAppUrl(frame.url);
  }

  // A handler that takes arguments must have a validator, so nothing
  // reaches it unchecked.
  function validatorFor(channel, handler) {
    const validate = args[channel];
    if (!validate && handler.length > 1) {
      throw new Error(`IPC channel ${channel} has no argument check`);
    }
    return validate;
  }

  function check(channel, event, input, validate) {
    if (!allowed(event)) {
      log(`[ipc] refused ${channel} from ${event?.senderFrame?.url ?? "?"}`);
      refuse("Not allowed");
    }
    if (!validate) return [];
    // A validator returns the full list of arguments the handler gets.
    const checked = validate(...input);
    if (!Array.isArray(checked)) refuse("Bad arguments");
    return checked;
  }

  return {
    allowed,
    handle(channel, handler) {
      const validate = validatorFor(channel, handler);
      ipcMain.handle(channel, (event, ...input) =>
        handler(event, ...check(channel, event, input, validate)),
      );
    },
    on(channel, handler) {
      const validate = validatorFor(channel, handler);
      ipcMain.on(channel, (event, ...input) => {
        let checked;
        try {
          checked = check(channel, event, input, validate);
        } catch {
          return;
        }
        handler(event, ...checked);
      });
    },
  };
}

// Validators. Each returns the cleaned value or throws.

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function string(value, { max, min = 0, pattern, name = "value" } = {}) {
  if (typeof value !== "string") refuse(`${name} must be text`);
  if (value.length < min || (max !== undefined && value.length > max)) {
    refuse(`${name} has the wrong length`);
  }
  if (pattern && !pattern.test(value)) refuse(`${name} is not allowed`);
  return value;
}

function optionalString(value, options) {
  return value === undefined || value === null
    ? undefined
    : string(value, options);
}

function settingKey(key) {
  string(key, { min: 1, max: 128, pattern: /^[A-Za-z0-9._:-]+$/, name: "key" });
  if (FORBIDDEN_KEYS.has(key)) refuse("key is not allowed");
  return key;
}

const MAX_SETTING_BYTES = 64 * 1024;

function settingValue(value) {
  if (value === undefined) return null;
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    refuse("value is not plain data");
  }
  if (text === undefined || text.length > MAX_SETTING_BYTES) {
    refuse("value is too large");
  }
  return JSON.parse(text);
}

const DIALOG_PROPERTIES = new Set([
  "openFile",
  "openDirectory",
  "multiSelections",
  "showHiddenFiles",
  "createDirectory",
  "promptToCreate",
  "dontAddToRecent",
  "showOverwriteConfirmation",
  "treatPackageAsDirectory",
]);

function dialogOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object" || Array.isArray(options)) {
    refuse("options must be an object");
  }
  const out = {};
  for (const field of ["title", "buttonLabel", "message", "nameFieldLabel"]) {
    const value = optionalString(options[field], { max: 500, name: field });
    if (value !== undefined) out[field] = value;
  }
  const defaultPath = optionalString(options.defaultPath, {
    max: 4096,
    name: "defaultPath",
  });
  if (defaultPath !== undefined) out.defaultPath = defaultPath;
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters) || options.filters.length > 32) {
      refuse("filters are not allowed");
    }
    out.filters = options.filters.map((filter) => ({
      name: string(filter?.name, { max: 200, name: "filter name" }),
      extensions: (Array.isArray(filter?.extensions) ? filter.extensions : [])
        .slice(0, 64)
        .map((ext) =>
          string(ext, {
            min: 1,
            max: 32,
            pattern: /^[\w*.-]+$/,
            name: "extension",
          }),
        ),
    }));
  }
  if (options.properties !== undefined) {
    if (!Array.isArray(options.properties)) refuse("properties must be a list");
    out.properties = options.properties.filter((p) => DIALOG_PROPERTIES.has(p));
  }
  return out;
}

const MAX_TEMP_CONTENT = 256 * 1024 * 1024;
const ENCODINGS = new Set(["utf8", "base64"]);

function encoding(value) {
  if (value === undefined || value === null) return "utf8";
  if (!ENCODINGS.has(value)) refuse("encoding is not allowed");
  return value;
}

function fileContent(value) {
  if (value === undefined || value === null) return "";
  return string(value, { max: MAX_TEMP_CONTENT, name: "content" });
}

function tempFile(data) {
  if (!data || typeof data !== "object") refuse("file data must be an object");
  return {
    fileName: string(data.fileName ?? "file", { max: 255, name: "fileName" }),
    content: fileContent(data.content),
    encoding: encoding(data.encoding),
  };
}

function tempFolder(data) {
  if (!data || typeof data !== "object")
    refuse("folder data must be an object");
  const files = data.files ?? [];
  if (!Array.isArray(files) || files.length > 10000) refuse("too many files");
  let total = 0;
  return {
    folderName: string(data.folderName ?? "files", {
      max: 255,
      name: "folderName",
    }),
    files: files.map((file) => {
      const content = fileContent(file?.content);
      total += content.length;
      if (total > MAX_TEMP_CONTENT) refuse("files are too large");
      return {
        relativePath: string(file?.relativePath ?? "", {
          max: 1024,
          name: "relativePath",
        }),
        content,
        encoding: encoding(file?.encoding),
      };
    }),
  };
}

const TEMP_ID = /^\d{1,16}-[a-z0-9]{1,16}$/;

function tempId(value) {
  return string(value, { max: 40, pattern: TEMP_ID, name: "tempId" });
}

function tempIds(value) {
  if (!Array.isArray(value) || value.length > 1000)
    refuse("ids must be a list");
  return value.map(tempId);
}

const CSS_COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i;

function titleBarColors(colors) {
  if (!colors || typeof colors !== "object") return {};
  const out = {};
  for (const field of ["color", "symbolColor"]) {
    const value = optionalString(colors[field], {
      max: 64,
      pattern: CSS_COLOR,
      name: field,
    });
    if (value) out[field] = value;
  }
  return out;
}

function trayNotice(text) {
  if (!text || typeof text !== "object") refuse("text must be an object");
  return {
    title: string(text.title, { min: 1, max: 200, name: "title" }),
    body: string(text.body, { min: 1, max: 500, name: "body" }),
  };
}

function plainObject(value, name = "value") {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    refuse(`${name} must be an object`);
  }
  return settingValue(value);
}

function viewId(value) {
  return string(String(value ?? ""), {
    min: 1,
    max: 128,
    pattern: /^[\w.:-]+$/,
    name: "id",
  });
}

function bounds(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const field of ["x", "y", "width", "height"]) {
    const n = Number(value[field]);
    out[field] = Number.isFinite(n) ? Math.min(Math.max(n, 0), 100000) : 0;
  }
  return out;
}

function viewOpen(options) {
  if (!options || typeof options !== "object")
    refuse("options must be an object");
  return {
    id: viewId(options.id),
    url: string(options.url, { min: 1, max: 8192, name: "url" }),
    bounds: bounds(options.bounds),
    visible: options.visible !== false,
    ignoreCert: options.ignoreCert === true,
  };
}

function clipboardText(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length > 16 * 1024 * 1024) refuse("text is too large");
  return text;
}

module.exports = {
  IpcRefused,
  createIpcGuard,
  validators: {
    bounds,
    clipboardText,
    dialogOptions,
    plainObject,
    settingKey,
    settingValue,
    string,
    tempFile,
    tempFolder,
    tempId,
    tempIds,
    titleBarColors,
    trayNotice,
    viewId,
    viewOpen,
  },
};
