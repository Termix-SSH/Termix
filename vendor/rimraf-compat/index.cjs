const fs = require("node:fs");

function normalizeArgs(options, callback) {
  if (typeof options === "function") {
    return [{}, options];
  }

  return [options || {}, callback];
}

function toRmOptions(options) {
  return {
    force: true,
    recursive: true,
    maxRetries: options.maxRetries || options.maxBusyTries || 0,
  };
}

function rimraf(targetPath, options, callback) {
  const [normalizedOptions, normalizedCallback] = normalizeArgs(
    options,
    callback,
  );

  if (typeof normalizedCallback === "function") {
    fs.rm(targetPath, toRmOptions(normalizedOptions), normalizedCallback);
    return;
  }

  return fs.promises.rm(targetPath, toRmOptions(normalizedOptions));
}

rimraf.sync = function rimrafSync(targetPath, options) {
  fs.rmSync(targetPath, toRmOptions(options || {}));
};

module.exports = rimraf;
