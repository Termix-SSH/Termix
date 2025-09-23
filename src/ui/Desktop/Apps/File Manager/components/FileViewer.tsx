import React, { useState, useEffect } from "react";
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
  Save,
  RotateCcw,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace,
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
import { Input } from "@/components/ui/input";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages, loadLanguage } from "@uiw/codemirror-extensions-langs";

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
  onDownload?: () => void;
}

// Get official icon for programming languages
function getLanguageIcon(filename: string): React.ReactNode {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename.toLowerCase();

  // Special filename handling
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

// Get file type and icon
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
    "md",
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

// Get CodeMirror language extension
function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename.toLowerCase();

  // Special filename handling
  if (["dockerfile", "makefile", "rakefile", "gemfile"].includes(baseName)) {
    return loadLanguage(baseName);
  }

  // Map by file extension
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

// Format file size
function formatFileSize(bytes?: number): string {
  if (!bytes) return "Unknown size";
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
  onDownload,
}: FileViewerProps) {
  const { t } = useTranslation();
  const [editedContent, setEditedContent] = useState(content);
  const [originalContent, setOriginalContent] = useState(
    savedContent || content,
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [showLargeFileWarning, setShowLargeFileWarning] = useState(false);
  const [forceShowAsText, setForceShowAsText] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplacePanel, setShowReplacePanel] = useState(false);
  const [searchMatches, setSearchMatches] = useState<
    { start: number; end: number }[]
  >([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);

  const fileTypeInfo = getFileType(file.name);

  // File size limits - remove hard limits, support large file handling
  const WARNING_SIZE = 50 * 1024 * 1024; // 50MB warning
  const MAX_SIZE = Number.MAX_SAFE_INTEGER; // Remove hard limits

  // Check if should display as text
  const shouldShowAsText =
    fileTypeInfo.type === "text" ||
    fileTypeInfo.type === "code" ||
    (fileTypeInfo.type === "unknown" &&
      (forceShowAsText || !file.size || file.size <= WARNING_SIZE));

  // Check if file is too large
  const isLargeFile = file.size && file.size > WARNING_SIZE;
  const isTooLarge = file.size && file.size > MAX_SIZE;

  // Sync external content changes
  useEffect(() => {
    setEditedContent(content);
    // Only update originalContent when savedContent is updated
    if (savedContent) {
      setOriginalContent(savedContent);
    }
    setHasChanges(content !== (savedContent || content));

    // If unknown file type and file is large, show warning
    if (fileTypeInfo.type === "unknown" && isLargeFile && !forceShowAsText) {
      setShowLargeFileWarning(true);
    } else {
      setShowLargeFileWarning(false);
    }
  }, [content, savedContent, fileTypeInfo.type, isLargeFile, forceShowAsText]);

  // Handle content changes
  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== originalContent);
    onContentChange?.(newContent);
  };

  // Save file
  const handleSave = () => {
    onSave?.(editedContent);
    // Note: Don't update originalContent here, as it will be updated via savedContent prop
  };

  // Revert file
  const handleRevert = () => {
    setEditedContent(originalContent);
    setHasChanges(false);
    onContentChange?.(originalContent);
  };

  // Search matching functionality
  const findMatches = (text: string) => {
    if (!text) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const matches: { start: number; end: number }[] = [];
    const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let match;

    while ((match = regex.exec(editedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
      });
      // Avoid infinite loop
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    setSearchMatches(matches);
    setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
  };

  // Search navigation
  const goToNextMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
  };

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex(
      (prev) => (prev - 1 + searchMatches.length) % searchMatches.length,
    );
  };

  // Replace functionality
  const handleFindReplace = (
    findText: string,
    replaceWithText: string,
    replaceAll: boolean = false,
  ) => {
    if (!findText) return;

    let newContent = editedContent;
    if (replaceAll) {
      newContent = newContent.replace(
        new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        replaceWithText,
      );
    } else if (currentMatchIndex >= 0 && searchMatches[currentMatchIndex]) {
      // Replace current match
      const match = searchMatches[currentMatchIndex];
      newContent =
        editedContent.substring(0, match.start) +
        replaceWithText +
        editedContent.substring(match.end);
    }

    setEditedContent(newContent);
    setHasChanges(newContent !== originalContent);
    onContentChange?.(newContent);

    // Re-search to update matches
    setTimeout(() => findMatches(findText), 0);
  };

  const handleFind = () => {
    setShowSearchPanel(true);
    setShowReplacePanel(false);
  };

  const handleReplace = () => {
    setShowSearchPanel(true);
    setShowReplacePanel(true);
  };

  // Render highlighted text
  const renderHighlightedText = (text: string) => {
    if (!searchText || searchMatches.length === 0) {
      return text;
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    searchMatches.forEach((match, index) => {
      // Add text before match
      if (match.start > lastIndex) {
        parts.push(text.substring(lastIndex, match.start));
      }

      // Add highlighted match text
      const isCurrentMatch = index === currentMatchIndex;
      parts.push(
        <span
          key={`match-${index}`}
          className={cn(
            "font-bold",
            isCurrentMatch
              ? "text-red-600 bg-yellow-200"
              : "text-blue-800 bg-blue-100",
          )}
        >
          {text.substring(match.start, match.end)}
        </span>,
      );

      lastIndex = match.end;
    });

    // Add final text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  // Handle user confirmation to open large file
  const handleConfirmOpenAsText = () => {
    setForceShowAsText(true);
    setShowLargeFileWarning(false);
  };

  // Handle user rejection to open large file
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
      {/* File info header */}
      <div className="flex-shrink-0 bg-card border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg bg-muted", fileTypeInfo.color)}>
              {fileTypeInfo.icon}
            </div>
            <div>
              <h3 className="font-medium text-foreground">{file.name}</h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{formatFileSize(file.size)}</span>
                {file.modified && <span>Modified: {file.modified}</span>}
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
            {/* Edit toolbar - display directly, no toggle needed */}
            {isEditable && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFind}
                  className="flex items-center gap-2"
                >
                  <Search className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReplace}
                  className="flex items-center gap-2"
                >
                  <Replace className="w-4 h-4" />
                </Button>
              </>
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
                Download
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Search and replace panel */}
      {showSearchPanel && (
        <div className="flex-shrink-0 bg-muted/30 border-b border-border p-3">
          <div className="flex items-center gap-2 mb-2">
            <Input
              placeholder={t("fileManager.find")}
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                findMatches(e.target.value);
              }}
              className="w-48 h-8"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPrevMatch}
                disabled={searchMatches.length === 0}
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextMatch}
                disabled={searchMatches.length === 0}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3rem]">
                {searchMatches.length > 0
                  ? `${currentMatchIndex + 1}/${searchMatches.length}`
                  : searchText
                    ? "0/0"
                    : ""}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowSearchPanel(false);
                setSearchText("");
                setSearchMatches([]);
                setCurrentMatchIndex(-1);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          {showReplacePanel && (
            <div className="flex items-center gap-2 mb-2">
              <Input
                placeholder={t("fileManager.replaceWith")}
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                className="w-48 h-8"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleFindReplace(searchText, replaceText, false)
                }
                disabled={!searchText}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFindReplace(searchText, replaceText, true)}
                disabled={!searchText}
              >
                Replace All
              </Button>
            </div>
          )}
        </div>
      )}

      {/* File content */}
      <div className="flex-1 overflow-hidden">
        {/* Large file warning dialog */}
        {showLargeFileWarning && (
          <div className="h-full flex items-center justify-center bg-background">
            <div className="bg-card border border-destructive/30 rounded-lg p-6 max-w-md mx-4 shadow-lg">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-foreground mb-2">
                    Large File Warning
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    This file is {formatFileSize(file.size)} in size, which may
                    cause performance issues when opened as text.
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
                  Download Instead
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

        {/* Image preview */}
        {fileTypeInfo.type === "image" && !showLargeFileWarning && (
          <div className="p-6 flex items-center justify-center h-full">
            <img
              src={`data:image/*;base64,${content}`}
              alt={file.name}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
                // Show error message instead
              }}
            />
          </div>
        )}

        {/* Text and code file preview */}
        {shouldShowAsText && !showLargeFileWarning && (
          <div className="h-full flex flex-col">
            {fileTypeInfo.type === "code" ? (
              // Code files use CodeMirror
              <div className="h-full">
                {searchText && searchMatches.length > 0 ? (
                  // When there are search results, show read-only highlighted text (with line numbers)
                  <div className="h-full flex bg-muted">
                    {/* Line number column */}
                    <div className="flex-shrink-0 bg-muted border-r border-border px-2 py-4 text-xs text-muted-foreground font-mono select-none">
                      {editedContent.split("\n").map((_, index) => (
                        <div
                          key={index + 1}
                          className="text-right leading-5 min-w-[2rem]"
                        >
                          {index + 1}
                        </div>
                      ))}
                    </div>
                    {/* Code content */}
                    <div className="flex-1 p-4 font-mono text-sm whitespace-pre-wrap overflow-auto text-foreground">
                      {renderHighlightedText(editedContent)}
                    </div>
                  </div>
                ) : (
                  // Show CodeMirror editor when no search
                  <CodeMirror
                    value={editedContent}
                    onChange={(value) => handleContentChange(value)}
                    extensions={
                      getLanguageExtension(file.name)
                        ? [getLanguageExtension(file.name)!]
                        : []
                    }
                    theme="dark"
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
                    }}
                    className="h-full overflow-auto"
                    readOnly={!isEditable}
                  />
                )}
              </div>
            ) : (
              // Plain text files
              <div className="h-full">
                {isEditable ? (
                  <div className="h-full">
                    {searchText && searchMatches.length > 0 ? (
                      // When there are search results, show read-only highlighted text
                      <div className="h-full p-4 font-mono text-sm whitespace-pre-wrap overflow-auto bg-background text-foreground">
                        {renderHighlightedText(editedContent)}
                      </div>
                    ) : (
                      // Use CodeMirror for all text files (unified editor experience)
                      <CodeMirror
                        value={editedContent}
                        onChange={(value) => handleContentChange(value)}
                        extensions={
                          getLanguageExtension(file.name)
                            ? [getLanguageExtension(file.name)!]
                            : []
                        }
                        theme={oneDark}
                        editable={isEditable}
                        placeholder={t("fileManager.startTyping")}
                        className="h-full text-sm"
                        basicSetup={{
                          lineNumbers: true,
                          foldGutter: true,
                          dropCursor: false,
                          allowMultipleSelections: false,
                          highlightSelectionMatches: false,
                          searchKeymap: true,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  // Only show as read-only for non-editable files (media files)
                  <div className="h-full p-4 font-mono text-sm whitespace-pre-wrap overflow-auto bg-background text-foreground">
                    {editedContent || content || "File is empty"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Video file preview */}
        {fileTypeInfo.type === "video" && !showLargeFileWarning && (
          <div className="p-6 flex items-center justify-center h-full">
            <video
              controls
              className="max-w-full max-h-full rounded-lg shadow-sm"
              src={`data:video/*;base64,${content}`}
            >
              Your browser does not support video playback.
            </video>
          </div>
        )}

        {/* Audio file preview */}
        {fileTypeInfo.type === "audio" && !showLargeFileWarning && (
          <div className="p-6 flex items-center justify-center h-full">
            <div className="text-center">
              <div
                className={cn(
                  "w-24 h-24 mx-auto mb-4 rounded-full bg-pink-100 flex items-center justify-center",
                  fileTypeInfo.color,
                )}
              >
                <Music className="w-12 h-12" />
              </div>
              <audio
                controls
                className="w-full max-w-md"
                src={`data:audio/*;base64,${content}`}
              >
                Your browser does not support audio playback.
              </audio>
            </div>
          </div>
        )}

        {/* Unknown file type - only show when cannot display as text and no warning */}
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
                    Download File
                  </Button>
                )}
              </div>
            </div>
          )}
      </div>

      {/* Bottom status bar */}
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
