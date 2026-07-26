const fs = require("node:fs");
const path = require("node:path");

const nanDir = path.join(__dirname, "..", "node_modules", "nan");

if (!fs.existsSync(nanDir)) {
  console.log("[patch-nan] nan not found, skipping");
  process.exit(0);
}

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return false;

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const { original, patched } of replacements) {
    if (source.includes(patched)) continue;
    if (!source.includes(original)) continue;
    source = source.replace(original, patched);
    changed = true;
  }

  if (changed) fs.writeFileSync(filePath, source);
  return changed;
}

// 1. nan.h: inject MSVC __builtin_frame_address compat before node.h is included.
const nanHeaderPatched = patchFile(path.join(nanDir, "nan.h"), [
  {
    original: `#include <node_version.h>

#define NODE_0_10_MODULE_VERSION 11`,
    patched: `#include <node_version.h>

// MSVC lacks __builtin_frame_address; cppgc/heap.h (pulled by node.h) uses it.
#if defined(_MSC_VER) && !defined(__clang__) && !defined(__builtin_frame_address)
# include <intrin.h>
# define __builtin_frame_address(level) _AddressOfReturnAddress()
#endif

// v8::External::New()/->Value() gained a mandatory ExternalPointerTypeTag
// argument in V8 15 (Electron 43+). Plain Node (V8 <= 13.x as of Node 24)
// still uses the old 2-arg signatures, so this must be conditional rather
// than assumed - a build can target either header set.
#include <v8-version.h>
#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 15
# define NAN_EXTERNAL_TAG_ARG , static_cast<v8::ExternalPointerTypeTag>(0)
# define NAN_EXTERNAL_TAG_PARAM static_cast<v8::ExternalPointerTypeTag>(0)
#else
# define NAN_EXTERNAL_TAG_ARG
# define NAN_EXTERNAL_TAG_PARAM
#endif

#define NODE_0_10_MODULE_VERSION 11`,
  },
]);

// cpu-features binding.cc includes <node.h> before <nan.h>, so the nan.h patch
// above is too late. Patch binding.cc directly to inject the compat define first.
const cpuFeaturesDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "cpu-features",
);
const bindingPath = path.join(cpuFeaturesDir, "src", "binding.cc");
const bindingPatched = patchFile(bindingPath, [
  {
    original: `#include <node.h>`,
    patched: `#if defined(_MSC_VER) && !defined(__clang__) && !defined(__builtin_frame_address)
#include <intrin.h>
#define __builtin_frame_address(level) _AddressOfReturnAddress()
#endif
#include <node.h>`,
  },
]);

// 2. nan_implementation_12_inl.h: replace v8::External::New() with a form that
//    passes NAN_EXTERNAL_TAG_ARG - a macro (defined in the nan.h patch above)
//    that expands to the ExternalPointerTypeTag argument only when the target
//    V8 headers actually declare it (V8 15+ / Electron 43+).
const implPath = path.join(nanDir, "nan_implementation_12_inl.h");
let implPatched = false;
if (fs.existsSync(implPath)) {
  let src = fs.readFileSync(implPath, "utf8");
  const before = src;

  if (!src.includes("NAN_EXTERNAL_TAG_ARG")) {
    src = src.replace(
      /v8::External::New\(v8::Isolate::GetCurrent\(\),\s*value(?:,\s*static_cast<v8::ExternalPointerTypeTag>\(0\))?\)/g,
      `v8::External::New(v8::Isolate::GetCurrent(), value NAN_EXTERNAL_TAG_ARG)`,
    );
    src = src.replace(
      /v8::External::New\(isolate,\s*reinterpret_cast<void \*>\(callback\)(?:,\s*static_cast<v8::ExternalPointerTypeTag>\(0\))?\)/g,
      `v8::External::New(isolate, reinterpret_cast<void *>(callback) NAN_EXTERNAL_TAG_ARG)`,
    );
  }

  if (src !== before) {
    fs.writeFileSync(implPath, src);
    implPatched = true;
  }
}

// 3. nan_callbacks_12_inl.h: replace ->Value() with ->Value(NAN_EXTERNAL_TAG_PARAM)
//    on v8::External, same conditional-tag reasoning as above.
const callbacksPath = path.join(nanDir, "nan_callbacks_12_inl.h");
let callbacksPatched = false;
if (fs.existsSync(callbacksPath)) {
  let src = fs.readFileSync(callbacksPath, "utf8");
  const before = src;

  if (!src.includes("NAN_EXTERNAL_TAG_PARAM")) {
    // Pattern: .As<v8::External>()->Value()) or ->Value(<old hardcoded tag>))
    src = src.replace(
      /\.As<v8::External>\(\)->Value\((?:static_cast<v8::ExternalPointerTypeTag>\(0\))?\)\)/g,
      `.As<v8::External>()->Value(NAN_EXTERNAL_TAG_PARAM))`,
    );
  }

  if (src !== before) {
    fs.writeFileSync(callbacksPath, src);
    callbacksPatched = true;
  }
}

if (nanHeaderPatched || bindingPatched || implPatched || callbacksPatched) {
  console.log(
    "[patch-nan] Applied compatibility patches for Electron 42 / V8 13+",
  );
} else {
  console.log("[patch-nan] Already patched or target code not found");
}
