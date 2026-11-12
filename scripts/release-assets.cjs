#!/usr/bin/env node
/**
 * Core releases are drafts until every file is uploaded, then published once
 * and never changed. This script holds the one list of files a release must
 * have and does every release file step the workflows need:
 *
 *   expected --channel stable|beta          print the expected file names
 *   notes add|strip <file>                  add or remove the uploading line
 *   state --tag <tag>                       print state=none|published|draft and id=
 *   upload --tag <tag> --dir <dir>          upload files to the draft
 *   check --channel <c> (--tag <t> | --dir <d>)
 *                                           fail on missing or unexpected files
 *   sums (--tag <t> | --dir <d>) --out <f>  write SHA256SUMS over every file
 *
 * Uploads never replace a file. A file already on the draft with the same
 * sha256 is skipped, so rerunning a failed job is safe. Anything else fails.
 * Reads GH_TOKEN and GITHUB_REPOSITORY.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const API = "https://api.github.com";
const UPLOADS = "https://uploads.github.com";
const UPLOADING_LINE =
  "Desktop files are still uploading. This release is published when they are done.";

// The signed checksum list and its Sigstore bundle. They are made last and
// never listed inside the checksums themselves.
const SUMS_FILE = "SHA256SUMS";
const SUMS_BUNDLE = "SHA256SUMS.sigstore.json";

const COMMON = [
  SUMS_BUNDLE,
  SUMS_FILE,
  "com.karmaa.termix.flatpakref",
  "termix_linux_aarch64_flatpak.flatpak",
  "termix_linux_arm64_appimage.AppImage",
  "termix_linux_arm64_deb.deb",
  "termix_linux_arm64_portable.tar.gz",
  "termix_linux_armv7l_appimage.AppImage",
  "termix_linux_armv7l_deb.deb",
  "termix_linux_armv7l_portable.tar.gz",
  "termix_linux_flatpak.flatpak",
  "termix_linux_x64_appimage.AppImage",
  "termix_linux_x64_deb.deb",
  "termix_linux_x64_full_appimage.AppImage",
  "termix_linux_x64_full_deb.deb",
  "termix_linux_x64_portable.tar.gz",
  "termix_macos_arm64_dmg.dmg",
  "termix_macos_arm64_update.zip",
  "termix_macos_arm64_update.zip.blockmap",
  "termix_macos_universal_dmg.dmg",
  "termix_macos_universal_full_dmg.dmg",
  "termix_macos_x64_dmg.dmg",
  "termix_macos_x64_update.zip",
  "termix_macos_x64_update.zip.blockmap",
  "termix_sbom.cdx.json",
  "termix_windows_arm64_msi.msi",
  "termix_windows_arm64_nsis.exe",
  "termix_windows_arm64_portable.zip",
  "termix_windows_ia32_msi.msi",
  "termix_windows_ia32_nsis.exe",
  "termix_windows_ia32_portable.zip",
  "termix_windows_x64_full_nsis.exe",
  "termix_windows_x64_msi.msi",
  "termix_windows_x64_nsis.exe",
  "termix_windows_x64_nsis.exe.blockmap",
  "termix_windows_x64_portable.zip",
];

// Update files the desktop updater reads, named by channel.
const UPDATE_FILES = [
  ".yml",
  "-linux.yml",
  "-linux-arm64.yml",
  "-linux-arm.yml",
  "-mac.yml",
];

// Betas never go to the App Store or Homebrew.
const STABLE_ONLY = ["termix_macos_universal_mas.pkg", "termix.rb"];

function expectedAssets(channel) {
  if (channel !== "stable" && channel !== "beta") {
    throw new Error(`unknown channel "${channel}"`);
  }
  const prefix = channel === "stable" ? "latest" : "beta";
  const names = [
    ...COMMON,
    ...UPDATE_FILES.map((suffix) => prefix + suffix),
    ...(channel === "stable" ? STABLE_ONLY : []),
  ];
  return names.sort();
}

/** Missing and unexpected names compared with the list. */
function compareAssets(channel, names) {
  const want = new Set(expectedAssets(channel));
  const have = new Set(names);
  return {
    missing: [...want].filter((name) => !have.has(name)).sort(),
    unexpected: [...have].filter((name) => !want.has(name)).sort(),
  };
}

/** sha256sum -c format: "<hex>  <name>", sorted by name. */
function formatSums(entries) {
  return (
    [...entries]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, sha256 }) => `${sha256}  ${name}`)
      .join("\n") + "\n"
  );
}

const isSumsFile = (name) => name === SUMS_FILE || name === SUMS_BUNDLE;

/** Checksums of a folder of files, read from disk. */
function sumsFromDir(dir, hash = sha256File) {
  const entries = [];
  for (const [name, file] of collectFiles(dir)) {
    if (!isSumsFile(name)) entries.push({ name, sha256: hash(file) });
  }
  return formatSums(entries);
}

/**
 * Checksums of a draft's files from the sha256 GitHub recorded at upload, so
 * nothing is downloaded (downloads would add to the public counts).
 */
function sumsFromAssets(assets) {
  const entries = [];
  for (const asset of assets) {
    if (isSumsFile(asset.name)) continue;
    const match = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest || ""));
    if (asset.state !== "uploaded" || !match) {
      throw new Error(`${asset.name} has no finished upload with a sha256`);
    }
    entries.push({ name: asset.name, sha256: match[1] });
  }
  return formatSums(entries);
}

function addUploadingLine(body) {
  const rest = stripUploadingLine(body);
  return `${UPLOADING_LINE}\n\n${rest}`;
}

function stripUploadingLine(body) {
  const text = String(body ?? "");
  if (!text.startsWith(UPLOADING_LINE)) return text;
  return text.slice(UPLOADING_LINE.length).replace(/^(\r?\n)+/, "");
}

/** Every file under dir by base name; two files with one name is an error. */
function collectFiles(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        if (files.has(entry.name)) {
          throw new Error(`${entry.name} is in more than one artifact`);
        }
        files.set(entry.name, full);
      }
    }
  };
  walk(dir);
  return files;
}

// Update files go up last: the desktop updater treats a release as ready
// once its update file is there.
function uploadOrder(names) {
  const isUpdate = (name) => name.endsWith(".yml");
  return [...names].sort((a, b) => {
    if (isUpdate(a) !== isUpdate(b)) return isUpdate(a) ? 1 : -1;
    return a.localeCompare(b);
  });
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function createClient({ token, repo, fetchImpl = fetch }) {
  if (!token) throw new Error("GH_TOKEN is not set");
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function request(url, init = {}) {
    const res = await fetchImpl(url, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `${init.method || "GET"} ${url} failed: ${res.status} ${text.slice(0, 300)}`,
      );
    }
    return res.status === 204 ? null : res.json();
  }

  async function paged(pathname) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const sep = pathname.includes("?") ? "&" : "?";
      const items = await request(
        `${API}${pathname}${sep}per_page=100&page=${page}`,
      );
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  return {
    listReleases: () => paged(`/repos/${repo}/releases`),
    getRelease: (id) => request(`${API}/repos/${repo}/releases/${id}`),
    listAssets: (id) => paged(`/repos/${repo}/releases/${id}/assets`),
    uploadAsset: (id, name, data) =>
      request(
        `${UPLOADS}/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: data,
        },
      ),
  };
}

/** none, published or draft for a tag, with the release when there is one. */
async function releaseState(client, tag) {
  const matches = (await client.listReleases()).filter(
    (release) => release && release.tag_name === tag,
  );
  if (matches.length === 0) return { state: "none", release: null };
  const published = matches.find((release) => !release.draft);
  if (published) return { state: "published", release: published };
  if (matches.length > 1) {
    throw new Error(
      `more than one draft release uses ${tag}; delete the extra drafts`,
    );
  }
  return { state: "draft", release: matches[0] };
}

// By id when there is one: a draft's tag can read "untagged-..." in the API
// until it is published, so a tag search can miss it.
async function draftFor(client, tag, id) {
  if (id) {
    const release = await client.getRelease(id);
    if (!release.draft) {
      throw new Error(
        `${tag} is already published and can't change; cut a new patch version`,
      );
    }
    return release;
  }
  const { state, release } = await releaseState(client, tag);
  if (state === "none") throw new Error(`no draft release for ${tag}`);
  if (state === "published") {
    throw new Error(
      `${tag} is already published and can't change; cut a new patch version`,
    );
  }
  return release;
}

async function uploadToDraft(
  client,
  {
    tag,
    id,
    files,
    log = console.log,
    hash = sha256File,
    read = fs.readFileSync,
  },
) {
  const release = await draftFor(client, tag, id);
  const assets = new Map(
    (await client.listAssets(release.id)).map((asset) => [asset.name, asset]),
  );
  const uploaded = [];
  const skipped = [];
  for (const name of uploadOrder(files.keys())) {
    const file = files.get(name);
    const existing = assets.get(name);
    if (existing) {
      const digest = String(existing.digest || "");
      if (existing.state === "uploaded" && digest === `sha256:${hash(file)}`) {
        log(`${name} is already on the draft`);
        skipped.push(name);
        continue;
      }
      throw new Error(
        `${name} is already on the ${tag} draft from another build. ` +
          "Delete that draft and run the release again.",
      );
    }
    // Check again right before each upload so nothing lands after a publish.
    const current = await client.getRelease(release.id);
    if (!current.draft) {
      throw new Error(`${tag} was published during the upload; stopping`);
    }
    log(`Uploading ${name}`);
    await client.uploadAsset(release.id, name, read(file));
    uploaded.push(name);
  }
  return { uploaded, skipped };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      args._.push(argv[i]);
      continue;
    }
    args[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

function report(channel, names) {
  const { missing, unexpected } = compareAssets(channel, names);
  for (const name of missing) console.error(`missing: ${name}`);
  for (const name of unexpected) console.error(`unexpected: ${name}`);
  if (missing.length || unexpected.length) {
    throw new Error("the release files don't match scripts/release-assets.cjs");
  }
  console.log(`All ${names.length} expected ${channel} files are there.`);
}

async function main(argv) {
  const args = parseArgs(argv);
  const draftId = args.id || process.env.RELEASE_ID || "";
  const [command, sub, file] = args._;
  const client = () =>
    createClient({
      token: process.env.GH_TOKEN,
      repo: process.env.GITHUB_REPOSITORY,
    });

  if (command === "expected") {
    console.log(expectedAssets(args.channel).join("\n"));
  } else if (command === "notes") {
    if (!file || (sub !== "add" && sub !== "strip")) {
      throw new Error("usage: notes add|strip <file>");
    }
    const body = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      sub === "add" ? addUploadingLine(body) : stripUploadingLine(body),
    );
  } else if (command === "state") {
    const { state, release } = await releaseState(client(), args.tag);
    const assets = release ? (release.assets || []).length : 0;
    console.log(
      `state=${state}\nid=${release ? release.id : ""}\nassets=${assets}`,
    );
  } else if (command === "upload") {
    const files = collectFiles(args.dir);
    const { uploaded, skipped } = await uploadToDraft(client(), {
      tag: args.tag,
      id: draftId,
      files,
    });
    console.log(
      `Uploaded ${uploaded.length}, already there ${skipped.length}.`,
    );
  } else if (command === "sums") {
    if (!args.out)
      throw new Error("usage: sums (--tag <t> | --dir <d>) --out <f>");
    let text;
    if (args.dir) {
      text = sumsFromDir(args.dir);
    } else {
      const c = client();
      const release = await draftFor(c, args.tag, draftId);
      text = sumsFromAssets(await c.listAssets(release.id));
    }
    fs.writeFileSync(args.out, text);
    console.log(`Wrote ${text.trim().split("\n").length} checksums.`);
  } else if (command === "check") {
    if (args.dir) {
      report(args.channel, [...collectFiles(args.dir).keys()]);
    } else {
      const c = client();
      const release = await draftFor(c, args.tag, draftId);
      const assets = await c.listAssets(release.id);
      const broken = assets.filter((asset) => asset.state !== "uploaded");
      if (broken.length) {
        throw new Error(
          `unfinished uploads: ${broken.map((asset) => asset.name).join(", ")}`,
        );
      }
      report(
        args.channel,
        assets.map((asset) => asset.name),
      );
    }
  } else {
    throw new Error(`unknown command "${command || ""}"`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  UPLOADING_LINE,
  addUploadingLine,
  collectFiles,
  compareAssets,
  createClient,
  expectedAssets,
  formatSums,
  releaseState,
  sumsFromAssets,
  sumsFromDir,
  stripUploadingLine,
  uploadOrder,
  uploadToDraft,
};
