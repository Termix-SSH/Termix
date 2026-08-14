import {
  markAdaptiveResourceUsed,
  runAdaptiveBackgroundTask,
} from "@/lib/adaptive-resource-budget";

export type FilePreviewKind =
  | "image"
  | "video"
  | "audio"
  | "markdown"
  | "pdf"
  | "text"
  | "code"
  | "unknown";

const extensions = {
  image: new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"]),
  video: new Set(["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"]),
  audio: new Set(["mp3", "wav", "flac", "ogg", "aac", "m4a"]),
  markdown: new Set(["md", "markdown", "mdown", "mkdn", "mdx"]),
  pdf: new Set(["pdf"]),
  text: new Set(["txt", "readme"]),
  code: new Set([
    "js",
    "ts",
    "jsx",
    "tsx",
    "py",
    "java",
    "cpp",
    "c",
    "cs",
    "php",
    "rb",
    "go",
    "rs",
    "html",
    "css",
    "scss",
    "less",
    "json",
    "xml",
    "yaml",
    "yml",
    "toml",
    "ini",
    "conf",
    "sh",
    "bash",
    "zsh",
    "sql",
    "vue",
    "svelte",
  ]),
} satisfies Record<Exclude<FilePreviewKind, "unknown">, Set<string>>;

const extensionlessCodeFiles = new Set([
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
]);

export function resolveFilePreviewKind(filename: string): FilePreviewKind {
  const lowerName = filename.toLowerCase();
  if (extensionlessCodeFiles.has(lowerName)) return "code";

  const extension = lowerName.split(".").pop() || "";
  for (const [kind, knownExtensions] of Object.entries(extensions)) {
    if (knownExtensions.has(extension)) return kind as FilePreviewKind;
  }
  return "unknown";
}

export const loadCodeEditor = () =>
  import("./components/CodeEditor.tsx").then((module) => ({
    default: module.CodeEditor,
  }));
export const loadImagePreview = () =>
  import("./components/ImagePreview.tsx").then((module) => ({
    default: module.ImagePreview,
  }));
export const loadMarkdownRenderer = () =>
  import("./components/MarkdownRenderer.tsx").then((module) => ({
    default: module.MarkdownRenderer,
  }));
export const loadPdfPreview = () =>
  import("./components/PdfPreview.tsx").then((module) => ({
    default: module.PdfPreview,
  }));
export const loadAudioPreview = () =>
  import("./components/AudioPreview.tsx").then((module) => ({
    default: module.AudioPreview,
  }));

const previewLoaders: Partial<Record<FilePreviewKind, () => Promise<unknown>>> =
  {
    image: loadImagePreview,
    audio: loadAudioPreview,
    markdown: loadMarkdownRenderer,
    pdf: loadPdfPreview,
    text: loadCodeEditor,
    code: loadCodeEditor,
    unknown: loadCodeEditor,
  };

export function preloadFilePreview(filename: string): void {
  const kind = resolveFilePreviewKind(filename);
  const loader = previewLoaders[kind];
  if (loader) runAdaptiveBackgroundTask("module", `preview:${kind}`, loader);
}

export function markFilePreviewUsed(filename: string): void {
  markAdaptiveResourceUsed(
    "module",
    `preview:${resolveFilePreviewKind(filename)}`,
  );
}
