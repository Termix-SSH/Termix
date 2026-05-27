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

// 2. nan_implementation_12_inl.h: replace v8::External::New() with the 3-arg form.
//    Electron 42 / V8 13+ requires an ExternalPointerTypeTag as the third argument.
const implPath = path.join(nanDir, "nan_implementation_12_inl.h");
let implPatched = false;
if (fs.existsSync(implPath)) {
  let src = fs.readFileSync(implPath, "utf8");
  const before = src;

  const TAG = "static_cast<v8::ExternalPointerTypeTag>(0)";
  if (!src.includes(TAG)) {
    src = src.replace(
      /v8::External::New\(v8::Isolate::GetCurrent\(\),\s*value\)/g,
      `v8::External::New(v8::Isolate::GetCurrent(), value, ${TAG})`,
    );
    src = src.replace(
      /v8::External::New\(isolate,\s*reinterpret_cast<void \*>\(callback\)\)/g,
      `v8::External::New(isolate, reinterpret_cast<void *>(callback), ${TAG})`,
    );
  }

  if (src !== before) {
    fs.writeFileSync(implPath, src);
    implPatched = true;
  }
}

// 3. nan_callbacks_12_inl.h: replace ->Value() with ->Value(tag) on v8::External.
//    The new API requires an ExternalPointerTypeTag argument.
const callbacksPath = path.join(nanDir, "nan_callbacks_12_inl.h");
let callbacksPatched = false;
if (fs.existsSync(callbacksPath)) {
  let src = fs.readFileSync(callbacksPath, "utf8");
  const before = src;

  const TAG = "static_cast<v8::ExternalPointerTypeTag>(0)";
  if (!src.includes(TAG)) {
    // Pattern: .As<v8::External>()->Value()) — always followed by ))
    src = src.replace(
      /\.As<v8::External>\(\)->Value\(\)\)/g,
      `.As<v8::External>()->Value(${TAG}))`,
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
