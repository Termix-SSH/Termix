import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
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
  SiOracle,
  SiCplusplus,
  SiC,
  SiDotnet,
  SiPhp,
  SiRuby,
  SiGo,
  SiRust,
  SiHtml5,
  SiCss3,
  SiSass,
  SiLess,
  SiJson,
  SiXml,
  SiYaml,
  SiToml,
  SiShell,
  SiVuedotjs,
  SiSvelte,
  SiMarkdown,
  SiGnubash,
  SiMysql,
  SiDocker,
} from "react-icons/si";
import { Button } from "@/components/ui/button";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";
import { EditorView, keymap } from "@codemirror/view";
import { searchKeymap, search, openSearchPanel } from "@codemirror/search";
import {
  defaultKeymap,
  history,
  historyKeymap,
  toggleComment,
} from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import ReactPlayer from "react-player";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark as syntaxTheme } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

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
    java: <SiOracle className="w-6 h-6 text-red-500" />,
    cpp: <SiCplusplus className="w-6 h-6 text-blue-600" />,
    c: <SiC className="w-6 h-6 text-blue-700" />,
    cs: <SiDotnet className="w-6 h-6 text-purple-600" />,
    php: <SiPhp className="w-6 h-6 text-indigo-500" />,
    rb: <SiRuby className="w-6 h-6 text-red-500" />,
    go: <SiGo className="w-6 h-6 text-cyan-500" />,
    rs: <SiRust className="w-6 h-6 text-orange-600" />,
    html: <SiHtml5 className="w-6 h-6 text-orange-500" />,
    css: <SiCss3 className="w-6 h-6 text-blue-500" />,
    scss: <SiSass className="w-6 h-6 text-pink-500" />,
    sass: <SiSass className="w-6 h-6 text-pink-500" />,
    less: <SiLess className="w-6 h-6 text-blue-600" />,
    json: <SiJson className="w-6 h-6 text-yellow-500" />,
    xml: <SiXml className="w-6 h-6 text-orange-500" />,
    yaml: <SiYaml className="w-6 h-6 text-red-400" />,
    yml: <SiYaml className="w-6 h-6 text-red-400" />,
    toml: <SiToml className="w-6 h-6 text-orange-400" />,
    sql: <SiMysql className="w-6 h-6 text-blue-500" />,
    sh: <SiGnubash className="w-6 h-6 text-gray-700" />,
    bash: <SiGnubash className="w-6 h-6 text-gray-700" />,
    zsh: <SiShell className="w-6 h-6 text-gray-700" />,
    vue: <SiVuedotjs className="w-6 h-6 text-green-500" />,
    svelte: <SiSvelte className="w-6 h-6 text-orange-500" />,
    md: <SiMarkdown className="w-6 h-6 text-gray-600" />,
    conf: <SiShell className="w-6 h-6 text-gray-600" />,
    ini: <Code className="w-6 h-6 text-gray-600" />,
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
      color: "text-gray-500",
    };
  }
}

function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename.toLowerCase();

  if (["dockerfile", "makefile", "rakefile", "gemfile"].includes(baseName)) {
    return loadLanguage(baseName);
  }

  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    go: "go",
    rs: "rust",
    html: "html",
    css: "css",
    scss: "sass",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    vue: "vue",
    svelte: "svelte",
    md: "markdown",
    conf: "shell",
    ini: "properties",
  };

  const language = langMap[ext];
  return language ? loadLanguage(language) : null;
}

function formatFileSize(bytes?: number, t?: any): string {
  if (!bytes) return t ? t("fileManager.unknownSize") : "Unknown size";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
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
  const [originalContent, setOriginalContent] = useState(
    savedContent || content,
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [showLargeFileWarning, setShowLargeFileWarning] = useState(false);
  const [forceShowAsText, setForceShowAsText] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.2);
  const [pdfError, setPdfError] = useState(false);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const editorRef = useRef<any>(null);

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

    if (
      fileTypeInfo.type === "image" &&
      file.name.toLowerCase().endsWith(".svg") &&
      content
    ) {
      setImageLoading(false);
      setImageLoadError(false);
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
          <p className="text-sm text-gray-600">Loading file...</p>
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
                onClick={() => {
                  if (editorRef.current) {
                    const view = editorRef.current.view;
                    if (view) {
                      openSearchPanel(view);
                    }
                  }
                }}
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
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+F
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.replace")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+H
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.findNext")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    F3
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.findPrevious")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Shift+F3
                  </kbd>
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
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+S
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.selectAll")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+A
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.undo")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+Z
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.redo")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+Y
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.toggleComment")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+/
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.autoComplete")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Ctrl+Space
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.moveLineUp")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Alt+↑
                  </kbd>
                </div>
                <div className="flex justify-between">
                  <span>{t("fileManager.moveLineDown")}</span>
                  <kbd className="px-2 py-1 bg-background rounded text-xs">
                    Alt+↓
                  </kbd>
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
          <div className="p-6 flex items-center justify-center h-full relative">
            {imageLoadError ? (
              <div className="text-center text-muted-foreground">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">
                  {t("fileManager.imageLoadError")}
                </h3>
                <p className="text-sm mb-4">{file.name}</p>
                {onDownload && (
                  <Button
                    variant="outline"
                    onClick={onDownload}
                    className="flex items-center gap-2 mx-auto"
                  >
                    <Download className="w-4 h-4" />
                    {t("fileManager.download")}
                  </Button>
                )}
              </div>
            ) : file.name.toLowerCase().endsWith(".svg") ? (
              <div
                className="max-w-full max-h-full flex items-center justify-center"
                style={{ maxHeight: "calc(100vh - 200px)" }}
                dangerouslySetInnerHTML={{ __html: content }}
                onLoad={() => {
                  setImageLoading(false);
                  setImageLoadError(false);
                }}
              />
            ) : (
              <PhotoProvider maskOpacity={0.7}>
                <PhotoView src={`data:image/*;base64,${content}`}>
                  <img
                    src={`data:image/*;base64,${content}`}
                    alt={file.name}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-sm cursor-pointer hover:shadow-lg transition-shadow"
                    style={{ maxHeight: "calc(100vh - 200px)" }}
                    onLoad={(e) => {
                      setImageLoading(false);
                      setImageLoadError(false);

                      const img = e.currentTarget;
                      if (
                        onMediaDimensionsChange &&
                        img.naturalWidth &&
                        img.naturalHeight
                      ) {
                        onMediaDimensionsChange({
                          width: img.naturalWidth,
                          height: img.naturalHeight,
                        });
                      }
                    }}
                    onError={() => {
                      setImageLoading(false);
                      setImageLoadError(true);
                    }}
                  />
                </PhotoView>
              </PhotoProvider>
            )}

            {imageLoading && !imageLoadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">
                    Loading image...
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {shouldShowAsText && !showLargeFileWarning && (
          <div className="h-full flex flex-col">
            {isEditable ? (
              <CodeMirror
                ref={editorRef}
                value={editedContent}
                onChange={(value) => handleContentChange(value)}
                onFocus={() => setEditorFocused(true)}
                onBlur={() => setEditorFocused(false)}
                extensions={[
                  ...(getLanguageExtension(file.name)
                    ? [getLanguageExtension(file.name)!]
                    : []),
                  history(),
                  search(),
                  autocompletion(),
                  keymap.of([
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...completionKeymap,
                    {
                      key: "Mod-/",
                      run: toggleComment,
                      preventDefault: true,
                    },
                    {
                      key: "Mod-h",
                      run: () => {
                        return false;
                      },
                      preventDefault: true,
                    },
                  ]),
                  EditorView.theme({
                    "&": {
                      height: "100%",
                    },
                    ".cm-scroller": {
                      overflow: "auto",
                    },
                    ".cm-editor": {
                      height: "100%",
                    },
                  }),
                ]}
                theme={oneDark}
                placeholder={t("fileManager.startTyping")}
                className="h-full"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  dropCursor: false,
                  allowMultipleSelections: false,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                  highlightSelectionMatches: false,
                  scrollPastEnd: false,
                }}
              />
            ) : (
              <div className="h-full p-4 font-mono text-sm whitespace-pre-wrap overflow-auto bg-background text-foreground">
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

                  <div className="flex-1 overflow-auto bg-muted/10">
                    <div className="p-4">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({
                            node,
                            inline,
                            className,
                            children,
                            ...props
                          }) {
                            const match = /language-(\w+)/.exec(
                              className || "",
                            );
                            return !inline && match ? (
                              <SyntaxHighlighter
                                style={syntaxTheme}
                                language={match[1]}
                                PreTag="div"
                                className="rounded-lg"
                                {...props}
                              >
                                {String(children).replace(/\n$/, "")}
                              </SyntaxHighlighter>
                            ) : (
                              <code
                                className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          },
                          h1: ({ children }) => (
                            <h1 className="text-2xl font-bold mb-4 mt-6 text-foreground border-b border-border pb-2">
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-xl font-semibold mb-3 mt-5 text-foreground border-b border-border pb-1">
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground">
                              {children}
                            </h3>
                          ),
                          h4: ({ children }) => (
                            <h4 className="text-base font-semibold mb-2 mt-3 text-foreground">
                              {children}
                            </h4>
                          ),
                          p: ({ children }) => (
                            <p className="mb-3 text-foreground leading-relaxed">
                              {children}
                            </p>
                          ),
                          ul: ({ children }) => (
                            <ul className="mb-3 ml-4 list-disc text-foreground">
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="mb-3 ml-4 list-decimal text-foreground">
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li className="mb-1 text-foreground">{children}</li>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-blue-500 pl-3 mb-3 italic text-muted-foreground bg-muted/30 py-1">
                              {children}
                            </blockquote>
                          ),
                          table: ({ children }) => (
                            <div className="mb-3 overflow-x-auto">
                              <table className="min-w-full border border-border rounded-lg text-sm">
                                {children}
                              </table>
                            </div>
                          ),
                          thead: ({ children }) => (
                            <thead className="bg-muted">{children}</thead>
                          ),
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => (
                            <tr className="border-b border-border">
                              {children}
                            </tr>
                          ),
                          th: ({ children }) => (
                            <th className="px-3 py-2 text-left font-semibold text-foreground">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="px-3 py-2 text-foreground">
                              {children}
                            </td>
                          ),
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 underline"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {editedContent || "Nothing to preview yet..."}
                      </ReactMarkdown>
                    </div>
                  </div>
                </>
              ) : (
                /* Full preview mode */
                <div className="flex-1 overflow-auto p-6">
                  <div className="max-w-4xl mx-auto">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || "");
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={syntaxTheme}
                              language={match[1]}
                              PreTag="div"
                              className="rounded-lg"
                              {...props}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          ) : (
                            <code
                              className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },
                        h1: ({ children }) => (
                          <h1 className="text-3xl font-bold mb-6 mt-8 text-foreground border-b border-border pb-2">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-2xl font-semibold mb-4 mt-6 text-foreground border-b border-border pb-1">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-xl font-semibold mb-3 mt-4 text-foreground">
                            {children}
                          </h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className="text-lg font-semibold mb-2 mt-3 text-foreground">
                            {children}
                          </h4>
                        ),
                        p: ({ children }) => (
                          <p className="mb-4 text-foreground leading-relaxed">
                            {children}
                          </p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-4 ml-6 list-disc text-foreground">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-4 ml-6 list-decimal text-foreground">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="mb-1 text-foreground">{children}</li>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-blue-500 pl-4 mb-4 italic text-muted-foreground bg-muted/30 py-2">
                            {children}
                          </blockquote>
                        ),
                        table: ({ children }) => (
                          <div className="mb-4 overflow-x-auto">
                            <table className="min-w-full border border-border rounded-lg">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="bg-muted">{children}</thead>
                        ),
                        tbody: ({ children }) => <tbody>{children}</tbody>,
                        tr: ({ children }) => (
                          <tr className="border-b border-border">{children}</tr>
                        ),
                        th: ({ children }) => (
                          <th className="px-4 py-2 text-left font-semibold text-foreground">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="px-4 py-2 text-foreground">
                            {children}
                          </td>
                        ),
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {editedContent}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {fileTypeInfo.type === "pdf" && !showLargeFileWarning && (
          <div className="h-full flex flex-col bg-background">
            <div className="flex-shrink-0 bg-muted/30 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                      disabled={pageNumber <= 1}
                    >
                      {t("fileManager.previous")}
                    </Button>
                    <span className="text-sm text-foreground px-3 py-1 bg-background rounded border">
                      {t("fileManager.pageXOfY", {
                        current: pageNumber,
                        total: numPages || 0,
                      })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPageNumber(Math.min(numPages || 1, pageNumber + 1))
                      }
                      disabled={!numPages || pageNumber >= numPages}
                    >
                      {t("fileManager.next")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPdfScale(Math.max(0.5, pdfScale - 0.2))}
                    >
                      {t("fileManager.zoomOut")}
                    </Button>
                    <span className="text-sm text-foreground px-3 py-1 bg-background rounded border min-w-[80px] text-center">
                      {Math.round(pdfScale * 100)}%
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPdfScale(Math.min(3.0, pdfScale + 0.2))}
                    >
                      {t("fileManager.zoomIn")}
                    </Button>
                  </div>
                </div>
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

            <div className="flex-1 overflow-auto p-6 bg-gray-100 dark:bg-gray-900">
              <div className="flex justify-center">
                {pdfError ? (
                  <div className="text-center text-muted-foreground p-8">
                    <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                    <h3 className="text-lg font-medium mb-2">
                      Cannot load PDF
                    </h3>
                    <p className="text-sm mb-4">
                      There was an error loading this PDF file.
                    </p>
                    {onDownload && (
                      <Button
                        variant="outline"
                        onClick={onDownload}
                        className="flex items-center gap-2 mx-auto"
                      >
                        <Download className="w-4 h-4" />
                        {t("fileManager.download")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <Document
                    file={`data:application/pdf;base64,${content}`}
                    onLoadSuccess={({ numPages }) => {
                      setNumPages(numPages);
                      setPdfError(false);

                      if (onMediaDimensionsChange) {
                        onMediaDimensionsChange({
                          width: 800,
                          height: 600,
                        });
                      }
                    }}
                    onLoadError={(error) => {
                      console.error("PDF load error:", error);
                      setPdfError(true);
                    }}
                    loading={
                      <div className="text-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                        <p className="text-sm text-muted-foreground">
                          Loading PDF...
                        </p>
                      </div>
                    }
                  >
                    <Page
                      pageNumber={pageNumber}
                      scale={pdfScale}
                      className="shadow-lg"
                      loading={
                        <div className="text-center p-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
                          <p className="text-xs text-muted-foreground">
                            Loading page...
                          </p>
                        </div>
                      }
                    />
                  </Document>
                )}
              </div>
            </div>
          </div>
        )}

        {fileTypeInfo.type === "audio" && !showLargeFileWarning && (
          <div className="p-6 flex items-center justify-center h-full">
            <div className="w-full max-w-2xl">
              {(() => {
                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                const mimeType = (() => {
                  switch (ext) {
                    case "mp3":
                      return "audio/mpeg";
                    case "wav":
                      return "audio/wav";
                    case "flac":
                      return "audio/flac";
                    case "ogg":
                      return "audio/ogg";
                    case "aac":
                      return "audio/aac";
                    case "m4a":
                      return "audio/mp4";
                    default:
                      return "audio/mpeg";
                  }
                })();

                const audioUrl = `data:${mimeType};base64,${content}`;

                return (
                  <div className="space-y-4">
                    <div className="flex justify-center">
                      <div
                        className={cn(
                          "w-32 h-32 rounded-lg bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center shadow-lg",
                          fileTypeInfo.color,
                        )}
                      >
                        <Music className="w-16 h-16 text-pink-600" />
                      </div>
                    </div>

                    <div className="text-center">
                      <h3 className="font-semibold text-foreground text-lg mb-1">
                        {file.name.replace(/\.[^/.]+$/, "")}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {ext.toUpperCase()} • {formatFileSize(file.size, t)}
                      </p>
                    </div>

                    <div className="rounded-lg overflow-hidden">
                      <AudioPlayer
                        src={audioUrl}
                        onLoadedMetadata={(e) => {
                          const audio = e.currentTarget;
                          if (onMediaDimensionsChange) {
                            onMediaDimensionsChange({
                              width: 600,
                              height: 400,
                            });
                          }
                        }}
                        onError={(e) => {
                          console.error("Audio playback error:", e);
                        }}
                        showJumpControls={false}
                        showSkipControls={false}
                        showDownloadProgress={true}
                        customAdditionalControls={[]}
                        customVolumeControls={[]}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
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
