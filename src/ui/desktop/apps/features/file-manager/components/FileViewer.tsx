import React, { Suspense, lazy, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils.ts";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  File as FileIcon,
  Code,
  AlertCircle,
  Download,
  Eye,
  Edit,
  Save,
  RotateCcw,
  Keyboard,
  Search,
} from "lucide-react";
import {
  SiJavascript,
  SiTypescript,
  SiPython,
  SiCplusplus,
  SiC,
  SiDotnet,
  SiPhp,
  SiRuby,
  SiGo,
  SiRust,
  SiHtml5,
  SiSass,
  SiVuedotjs,
  SiSvelte,
  SiMarkdown,
  SiGnubash,
  SiMysql,
  SiDocker,
} from "react-icons/si";
import { Button } from "@/components/ui/button.tsx";
import type { CodeEditorHandle } from "./CodeEditor.tsx";

const CodeEditor = lazy(() =>
  import("./CodeEditor.tsx").then((module) => ({
    default: module.CodeEditor,
  })),
);
const ImagePreview = lazy(() =>
  import("./ImagePreview.tsx").then((module) => ({
    default: module.ImagePreview,
  })),
);
const MarkdownRenderer = lazy(() =>
  import("./MarkdownRenderer.tsx").then((module) => ({
    default: module.MarkdownRenderer,
  })),
);
const PdfPreview = lazy(() =>
  import("./PdfPreview.tsx").then((module) => ({
    default: module.PdfPreview,
  })),
);
const AudioPreview = lazy(() =>
  import("./AudioPreview.tsx").then((module) => ({
    default: module.AudioPreview,
  })),
);

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

interface FileViewerProps {
  file: FileItem;
  content?: string;
  savedContent?: string;
  isLoading?: boolean;
  isEditable?: boolean;
  onContentChange?: (content: string) => void;
  onSave?: (content: string) => void;
  onRevert?: () => void;
  onDownload?: () => void;
  onMediaDimensionsChange?: (dimensions: {
    width: number;
    height: number;
  }) => void;
}

function getLanguageIcon(filename: string): React.ReactNode {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename.toLowerCase();

  if (["dockerfile"].includes(baseName)) {
    return <SiDocker className="w-6 h-6 text-blue-400" />;
  }
  if (["makefile", "rakefile", "gemfile"].includes(baseName)) {
    return <SiRuby className="w-6 h-6 text-red-500" />;
  }

  const iconMap: Record<string, React.ReactNode> = {
    js: <SiJavascript className="w-6 h-6 text-yellow-400" />,
    jsx: <SiJavascript className="w-6 h-6 text-yellow-400" />,
    ts: <SiTypescript className="w-6 h-6 text-blue-500" />,
    tsx: <SiTypescript className="w-6 h-6 text-blue-500" />,
    py: <SiPython className="w-6 h-6 text-blue-400" />,
    java: <Code className="w-6 h-6 text-red-500" />,
    cpp: <SiCplusplus className="w-6 h-6 text-blue-600" />,
    c: <SiC className="w-6 h-6 text-blue-700" />,
    cs: <SiDotnet className="w-6 h-6 text-purple-600" />,
    php: <SiPhp className="w-6 h-6 text-indigo-500" />,
    rb: <SiRuby className="w-6 h-6 text-red-500" />,
    go: <SiGo className="w-6 h-6 text-cyan-500" />,
    rs: <SiRust className="w-6 h-6 text-orange-600" />,
    html: <SiHtml5 className="w-6 h-6 text-orange-500" />,
    css: <Code className="w-6 h-6 text-blue-500" />,
    scss: <SiSass className="w-6 h-6 text-pink-500" />,
    sass: <SiSass className="w-6 h-6 text-pink-500" />,
    less: <Code className="w-6 h-6 text-blue-600" />,
    json: <Code className="w-6 h-6 text-yellow-500" />,
    xml: <Code className="w-6 h-6 text-orange-500" />,
    yaml: <Code className="w-6 h-6 text-red-400" />,
    yml: <Code className="w-6 h-6 text-red-400" />,
    toml: <Code className="w-6 h-6 text-orange-400" />,
    sql: <SiMysql className="w-6 h-6 text-blue-500" />,
    sh: <SiGnubash className="w-6 h-6 text-foreground" />,
    bash: <SiGnubash className="w-6 h-6 text-foreground" />,
    zsh: <Code className="w-6 h-6 text-foreground" />,
    vue: <SiVuedotjs className="w-6 h-6 text-green-500" />,
    svelte: <SiSvelte className="w-6 h-6 text-orange-500" />,
    md: <SiMarkdown className="w-6 h-6 text-muted-foreground" />,
    conf: <Code className="w-6 h-6 text-muted-foreground" />,
    ini: <Code className="w-6 h-6 text-muted-foreground" />,
  };

  return iconMap[ext] || <Code className="w-6 h-6 text-yellow-500" />;
}

function getFileType(filename: string): {
  type: string;
  icon: React.ReactNode;
  color: string;
} {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  const imageExts = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"];
  const audioExts = ["mp3", "wav", "flac", "ogg", "aac", "m4a"];
  const textExts = ["txt", "readme"];
  const markdownExts = ["md", "markdown", "mdown", "mkdn", "mdx"];
  const pdfExts = ["pdf"];
  const codeExts = [
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
  ];

  if (imageExts.includes(ext)) {
    return {
      type: "image",
      icon: <ImageIcon className="w-6 h-6" />,
      color: "text-green-500",
    };
  } else if (videoExts.includes(ext)) {
    return {
      type: "video",
      icon: <Film className="w-6 h-6" />,
      color: "text-purple-500",
    };
  } else if (audioExts.includes(ext)) {
    return {
      type: "audio",
      icon: <Music className="w-6 h-6" />,
      color: "text-pink-500",
    };
  } else if (markdownExts.includes(ext)) {
    return {
      type: "markdown",
      icon: <FileText className="w-6 h-6" />,
      color: "text-blue-600",
    };
  } else if (pdfExts.includes(ext)) {
    return {
      type: "pdf",
      icon: <FileText className="w-6 h-6" />,
      color: "text-red-600",
    };
  } else if (textExts.includes(ext)) {
    return {
      type: "text",
      icon: <FileText className="w-6 h-6" />,
      color: "text-blue-500",
    };
  } else if (codeExts.includes(ext)) {
    return {
      type: "code",
      icon: getLanguageIcon(filename),
      color: "text-yellow-500",
    };
  } else {
    return {
      type: "unknown",
      icon: <FileIcon className="w-6 h-6" />,
      color: "text-foreground-subtle",
    };
  }
}

function formatFileSize(bytes?: number, t?: (key: string) => string): string {
  if (!bytes) return t ? t("fileManager.unknownSize") : "Unknown size";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function PreviewFallback({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function FileViewer({
  file,
  content = "",
  savedContent = "",
  isLoading = false,
  isEditable = false,
  onContentChange,
  onSave,
  onRevert,
  onDownload,
  onMediaDimensionsChange,
}: FileViewerProps) {
  const { t } = useTranslation();
  const [editedContent, setEditedContent] = useState(content);
  const [, setOriginalContent] = useState(savedContent || content);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLargeFileWarning, setShowLargeFileWarning] = useState(false);
  const [forceShowAsText, setForceShowAsText] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const editorRef = useRef<CodeEditorHandle | null>(null);

  const fileTypeInfo = getFileType(file.name);

  const WARNING_SIZE = 50 * 1024 * 1024;
  const MAX_SIZE = Number.MAX_SAFE_INTEGER;

  const shouldShowAsText =
    fileTypeInfo.type === "text" ||
    fileTypeInfo.type === "code" ||
    (fileTypeInfo.type === "unknown" &&
      (forceShowAsText || !file.size || file.size <= WARNING_SIZE));

  const isLargeFile = file.size && file.size > WARNING_SIZE;
  const isTooLarge = file.size && file.size > MAX_SIZE;

  useEffect(() => {
    setEditedContent(content);
    if (savedContent) {
      setOriginalContent(savedContent);
    }
    setHasChanges(content !== savedContent);

    if (fileTypeInfo.type === "unknown" && isLargeFile && !forceShowAsText) {
      setShowLargeFileWarning(true);
    } else {
      setShowLargeFileWarning(false);
    }
  }, [
    content,
    savedContent,
    fileTypeInfo.type,
    isLargeFile,
    forceShowAsText,
    file.name,
  ]);

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== savedContent);
    onContentChange?.(newContent);
  };

  const handleSave = () => {
    onSave?.(editedContent);
  };

  const handleRevert = () => {
    if (onRevert) {
      onRevert();
    } else {
      setEditedContent(savedContent);
      setHasChanges(false);
    }
  };

  useEffect(() => {
    if (!editorFocused || !isEditable) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editorFocused, isEditable, handleSave]);

  const handleConfirmOpenAsText = () => {
    setForceShowAsText(true);
    setShowLargeFileWarning(false);
  };

  const handleCancelOpenAsText = () => {
    setShowLargeFileWarning(false);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 bg-card border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg bg-muted", fileTypeInfo.color)}>
              {fileTypeInfo.icon}
            </div>
            <div>
              <h3 className="font-medium text-foreground">{file.name}</h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{formatFileSize(file.size, t)}</span>
                {file.modified && (
                  <span>
                    {t("fileManager.modified")}: {file.modified}
                  </span>
                )}
                <span
                  className={cn(
                    "px-2 py-1 rounded-full text-xs",
                    fileTypeInfo.color,
                    "bg-muted",
                  )}
                >
                  {fileTypeInfo.type.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editorRef.current?.openSearchPanel()}
                className="flex items-center gap-2"
                title={t("fileManager.searchInFile")}
              >
                <Search className="w-4 h-4" />
              </Button>
            )}
            {isEditable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowKeyboardShortcuts(!showKeyboardShortcuts)}
                className="flex items-center gap-2"
                title={t("fileManager.showKeyboardShortcuts")}
              >
                <Keyboard className="w-4 h-4" />
              </Button>
            )}
            {hasChanges && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevert}
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Revert
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  className="flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save
                </Button>
              </>
            )}
            {onDownload && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {t("fileManager.download")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showKeyboardShortcuts && isEditable && (
        <div className="flex-shrink-0 bg-muted/30 border-b border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              {t("fileManager.keyboardShortcuts")}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowKeyboardShortcuts(false)}
              className="h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground">
                {t("fileManager.searchAndReplace")}
              </h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>{t("fileManager.search")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+F
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.replace")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+H
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.findNext")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      F3
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.findPrevious")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Shift+F3
                    </KbdKey>
                  </Kbd>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground">
                {t("fileManager.editing")}
              </h4>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>{t("fileManager.save")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+S
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.selectAll")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+A
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.undo")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+Z
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.redo")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+Y
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.toggleComment")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+/
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.autoComplete")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Ctrl+Space
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.moveLineUp")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Alt+↑
                    </KbdKey>
                  </Kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.moveLineDown")}</span>
                  <Kbd className="px-2 py-1 bg-background rounded text-xs">
                    <KbdKey className="px-2 py-1 bg-background rounded text-xs">
                      Alt+↓
                    </KbdKey>
                  </Kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {showLargeFileWarning && (
          <div className="h-full flex items-center justify-center bg-background">
            <div className="bg-card border border-destructive/30 rounded-lg p-6 max-w-md mx-4 shadow-lg">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-foreground mb-2">
                    {t("fileManager.largeFileWarning")}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {t("fileManager.largeFileWarningDesc", {
                      size: formatFileSize(file.size, t),
                    })}
                  </p>
                  {isTooLarge ? (
                    <div className="bg-destructive/10 border border-destructive/30 rounded p-3 mb-4">
                      <p className="text-sm text-destructive font-medium">
                        File is too large (&gt; 10MB) and cannot be opened as
                        text for security reasons.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      Do you want to continue opening this file as text? This
                      may slow down your browser.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {!isTooLarge && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleConfirmOpenAsText}
                    className="flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Open as Text
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDownload}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t("fileManager.downloadInstead")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelOpenAsText}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {fileTypeInfo.type === "image" && !showLargeFileWarning && (
          <Suspense fallback={<PreviewFallback label="Loading image..." />}>
            <ImagePreview
              content={content}
              fileName={file.name}
              onDownload={onDownload}
              onMediaDimensionsChange={onMediaDimensionsChange}
            />
          </Suspense>
        )}

        {shouldShowAsText && !showLargeFileWarning && (
          <div className="h-full flex flex-col">
            {isEditable ? (
              <Suspense
                fallback={<PreviewFallback label="Loading editor..." />}
              >
                <CodeEditor
                  ref={editorRef}
                  fileName={file.name}
                  value={editedContent}
                  onChange={handleContentChange}
                  onFocus={() => setEditorFocused(true)}
                  onBlur={() => setEditorFocused(false)}
                  placeholder={t("fileManager.startTyping")}
                />
              </Suspense>
            ) : (
              <div className="h-full p-4 font-mono text-sm whitespace-pre-wrap overflow-auto thin-scrollbar bg-background text-foreground">
                {editedContent || content || t("fileManager.fileIsEmpty")}
              </div>
            )}
          </div>
        )}

        {fileTypeInfo.type === "video" && !showLargeFileWarning && (
          <div className="p-6 flex items-center justify-center h-full">
            <div className="w-full max-w-4xl">
              {(() => {
                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                const mimeType = (() => {
                  switch (ext) {
                    case "mp4":
                      return "video/mp4";
                    case "webm":
                      return "video/webm";
                    case "mkv":
                      return "video/x-matroska";
                    case "avi":
                      return "video/x-msvideo";
                    case "mov":
                      return "video/quicktime";
                    case "wmv":
                      return "video/x-ms-wmv";
                    case "flv":
                      return "video/x-flv";
                    default:
                      return "video/mp4";
                  }
                })();

                const videoUrl = `data:${mimeType};base64,${content}`;

                return (
                  <div className="relative">
                    <video
                      controls
                      className="w-full rounded-lg shadow-sm"
                      style={{
                        maxHeight: "calc(100vh - 200px)",
                        backgroundColor: "#000",
                      }}
                      preload="metadata"
                      onError={(e) => {
                        console.error(
                          "Video playback error:",
                          e.currentTarget.error,
                        );
                      }}
                      onLoadedMetadata={(e) => {
                        const video = e.currentTarget;
                        if (
                          onMediaDimensionsChange &&
                          video.videoWidth &&
                          video.videoHeight
                        ) {
                          onMediaDimensionsChange({
                            width: video.videoWidth,
                            height: video.videoHeight,
                          });
                        }
                      }}
                    >
                      <source src={videoUrl} type={mimeType} />
                      <div className="text-center text-muted-foreground p-4">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                        <p>
                          Your browser does not support video playback for this
                          format.
                        </p>
                        {onDownload && (
                          <Button
                            variant="outline"
                            onClick={onDownload}
                            className="mt-2 flex items-center gap-2 mx-auto"
                          >
                            <Download className="w-4 h-4" />
                            Download to play externally
                          </Button>
                        )}
                      </div>
                    </video>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {fileTypeInfo.type === "markdown" && !showLargeFileWarning && (
          <div className="h-full flex flex-col">
            <div className="flex-shrink-0 bg-muted/30 border-b border-border p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant={markdownEditMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMarkdownEditMode(true)}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    {t("fileManager.edit")}
                  </Button>
                  <Button
                    variant={!markdownEditMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMarkdownEditMode(false)}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    {t("fileManager.preview")}
                  </Button>
                </div>
                <div className="flex items-center gap-2"></div>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {markdownEditMode ? (
                <>
                  <div className="flex-1 border-r border-border">
                    <div className="h-full p-4 bg-background">
                      <textarea
                        value={editedContent}
                        onChange={(e) => {
                          setEditedContent(e.target.value);
                          onContentChange?.(e.target.value);
                        }}
                        className="w-full h-full resize-none border-0 bg-transparent text-foreground font-mono text-sm leading-relaxed focus:outline-none focus:ring-0"
                        placeholder={t("fileManager.startWritingMarkdown")}
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto thin-scrollbar bg-muted/10">
                    <div className="p-4">
                      <Suspense
                        fallback={
                          <PreviewFallback label="Loading preview..." />
                        }
                      >
                        <MarkdownRenderer
                          compact
                          content={editedContent || "Nothing to preview yet..."}
                        />
                      </Suspense>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 overflow-auto thin-scrollbar p-6">
                  <div className="max-w-4xl mx-auto">
                    <Suspense
                      fallback={<PreviewFallback label="Loading preview..." />}
                    >
                      <MarkdownRenderer content={editedContent} />
                    </Suspense>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {fileTypeInfo.type === "pdf" && !showLargeFileWarning && (
          <Suspense
            fallback={<PreviewFallback label="Loading PDF viewer..." />}
          >
            <PdfPreview
              content={content}
              onDownload={onDownload}
              onMediaDimensionsChange={onMediaDimensionsChange}
            />
          </Suspense>
        )}

        {fileTypeInfo.type === "audio" && !showLargeFileWarning && (
          <Suspense
            fallback={<PreviewFallback label="Loading audio player..." />}
          >
            <AudioPreview
              file={file}
              content={content}
              color={fileTypeInfo.color}
              onMediaDimensionsChange={onMediaDimensionsChange}
            />
          </Suspense>
        )}

        {fileTypeInfo.type === "unknown" &&
          !shouldShowAsText &&
          !showLargeFileWarning && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">
                  Cannot preview this file type
                </h3>
                <p className="text-sm mb-4">
                  This file type is not supported for preview. You can download
                  it to view in an external application.
                </p>
                {onDownload && (
                  <Button
                    variant="outline"
                    onClick={onDownload}
                    className="flex items-center gap-2 mx-auto"
                  >
                    <Download className="w-4 h-4" />
                    {t("fileManager.downloadFile")}
                  </Button>
                )}
              </div>
            </div>
          )}
      </div>

      <div className="flex-shrink-0 bg-muted/50 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex justify-between items-center">
          <span>{file.path}</span>
          {hasChanges && (
            <span className="text-orange-600 font-medium">
              ● Unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
