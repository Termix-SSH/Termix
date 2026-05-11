import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
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

export interface CodeEditorHandle {
  openSearchPanel: () => void;
}

interface CodeEditorProps {
  fileName: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
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

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    { fileName, value, placeholder, onChange, onFocus, onBlur },
    ref,
  ) {
    const editorRef = useRef<{ view?: EditorView } | null>(null);

    const extensions = useMemo(() => {
      const languageExtension = getLanguageExtension(fileName);

      return [
        ...(languageExtension ? [languageExtension] : []),
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
            run: () => false,
            preventDefault: true,
          },
        ]),
        EditorView.theme({
          "&": {
            height: "100%",
          },
          ".cm-scroller": {
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--scrollbar-thumb) var(--scrollbar-track)",
          },
          ".cm-editor": {
            height: "100%",
          },
        }),
      ];
    }, [fileName]);

    useImperativeHandle(
      ref,
      () => ({
        openSearchPanel: () => {
          const view = editorRef.current?.view;
          if (view) {
            openSearchPanel(view);
          }
        },
      }),
      [],
    );

    return (
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        extensions={extensions}
        theme={oneDark}
        placeholder={placeholder}
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
    );
  },
);
