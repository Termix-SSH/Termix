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
    return { changed: false, unmatched: [] };
  }

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;
  const unmatched = [];

  for (const { label, original, patched } of replacements) {
    if (source.includes(patched)) {
      continue;
    }
    if (!source.includes(original)) {
      unmatched.push(`${path.basename(filePath)} (${label})`);
      continue;
    }
    source = source.replace(original, patched);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, source);
  }

  return { changed, unmatched };
}

if (!fs.existsSync(betterSqlite3Dir)) {
  console.log("[patch-better-sqlite3] better-sqlite3 not found, skipping");
  process.exit(0);
}

// better-sqlite3 >= 13 uses Node-API (<napi.h>) instead of direct V8 C++ APIs,
// so the V8 External/SetNativeDataProperty compatibility patches do not apply.
if (
  fs.existsSync(entryPath) &&
  fs.readFileSync(entryPath, "utf8").includes("#include <napi.h>")
) {
  console.log(
    "[patch-better-sqlite3] N-API build detected, V8 compatibility patches not needed",
  );
  process.exit(0);
}

const macrosResult = patchFile(macrosPath, [
  {
    label: "v8::External macros",
    original: `#define OnlyContext isolate->GetCurrentContext()
#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())
#define UseIsolate v8::Isolate* isolate = OnlyIsolate`,
    patched: `#define OnlyContext isolate->GetCurrentContext()
#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 15
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

const helpersResult = patchFile(helpersPath, [
  {
    label: "SetNativeDataProperty",
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

const entryResult = patchFile(entryPath, [
  {
    label: "MSVC __builtin_frame_address",
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
    label: "v8::External::New",
    original: `\tv8::Local<v8::External> data = v8::External::New(isolate, addon);`,
    patched: `\tv8::Local<v8::External> data = EXTERNAL_NEW(isolate, addon);`,
  },
]);

const unmatched = [
  ...macrosResult.unmatched,
  ...helpersResult.unmatched,
  ...entryResult.unmatched,
];
if (unmatched.length > 0) {
  console.error(
    `[patch-better-sqlite3] Target code not found and not already patched: ${unmatched.join(", ")}`,
  );
  process.exit(1);
}

if (macrosResult.changed || helpersResult.changed || entryResult.changed) {
  console.log(
    "[patch-better-sqlite3] Applied compatibility patches for newer Electron/V8",
  );
} else {
  console.log("[patch-better-sqlite3] Already patched");
}
