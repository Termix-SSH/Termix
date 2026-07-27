function getUnpackedAppRoot(appRoot) {
  return appRoot.replace(
    /app(-[a-z0-9]+)?\.asar(?!\.unpacked)/,
    "app$1.asar.unpacked",
  );
}

module.exports = { getUnpackedAppRoot };
