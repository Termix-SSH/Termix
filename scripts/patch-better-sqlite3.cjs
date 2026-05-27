const fs = require("node:fs");
const path = require("node:path");

const betterSqlite3Dir = path.join(
  __dirname,
  "..",
  "node_modules",
  "better-sqlite3",
);
const macrosPath = path.join(betterSqlite3Dir, "src", "util", "macros.cpp");
const helpersPath = path.join(betterSqlite3Dir, "src", "util", "helpers.cpp");
const entryPath = path.join(betterSqlite3Dir, "src", "better_sqlite3.cpp");

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const { original, patched } of replacements) {
    if (source.includes(patched)) {
      continue;
    }
    if (!source.includes(original)) {
      continue;
    }
    source = source.replace(original, patched);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, source);
  }

  return changed;
}

if (!fs.existsSync(betterSqlite3Dir)) {
  console.log("[patch-better-sqlite3] better-sqlite3 not found, skipping");
  process.exit(0);
}

const macrosPatched = patchFile(macrosPath, [
  {
    original: `#define OnlyContext isolate->GetCurrentContext()
#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())
#define UseIsolate v8::Isolate* isolate = OnlyIsolate`,
    patched: `#define OnlyContext isolate->GetCurrentContext()
#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 14
#define BETTER_SQLITE3_EXTERNAL_POINTER_TAG static_cast<v8::ExternalPointerTypeTag>(0)
#define EXTERNAL_VALUE(external) ((external)->Value(BETTER_SQLITE3_EXTERNAL_POINTER_TAG))
#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value), BETTER_SQLITE3_EXTERNAL_POINTER_TAG)
#else
#define EXTERNAL_VALUE(external) ((external)->Value())
#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value))
#endif
#define OnlyAddon static_cast<Addon*>(EXTERNAL_VALUE(info.Data().As<v8::External>()))
#define UseIsolate v8::Isolate* isolate = OnlyIsolate`,
  },
]);

const helpersPatched = patchFile(helpersPath, [
  {
    original: `\trecv->InstanceTemplate()->SetNativeDataProperty(
\t\tInternalizedFromLatin1(isolate, name),
\t\tfunc,
\t\t0,
\t\tdata
\t);`,
    patched: `\trecv->InstanceTemplate()->SetNativeDataProperty(
\t\tInternalizedFromLatin1(isolate, name),
\t\tfunc,
\t\tstatic_cast<v8::AccessorNameSetterCallback>(nullptr),
\t\tdata
\t);`,
  },
]);

const entryPatched = patchFile(entryPath, [
  {
    original: `#include <sqlite3.h>
#include <node.h>`,
    patched: `#include <sqlite3.h>
#if defined(_MSC_VER) && !defined(__clang__) && !defined(__builtin_frame_address)
#include <intrin.h>
#define __builtin_frame_address(level) _AddressOfReturnAddress()
#endif
#include <node.h>`,
  },
  {
    original: `\tv8::Local<v8::External> data = v8::External::New(isolate, addon);`,
    patched: `\tv8::Local<v8::External> data = EXTERNAL_NEW(isolate, addon);`,
  },
]);

if (macrosPatched || helpersPatched || entryPatched) {
  console.log(
    "[patch-better-sqlite3] Applied compatibility patches for newer Electron/V8",
  );
} else {
  console.log(
    "[patch-better-sqlite3] Already patched or target code not found",
  );
}
