const fs = require("node:fs");

function renameLocalPath(source, target) {
  if (source === target) return;
  try {
    fs.lstatSync(target);
    const error = new Error("A file or folder with that name already exists");
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (fs.lstatSync(source).isDirectory()) {
    fs.renameSync(source, target);
    return;
  }
  // link is exclusive: a destination created concurrently is never replaced.
  fs.linkSync(source, target);
  fs.unlinkSync(source);
}

module.exports = { renameLocalPath };
