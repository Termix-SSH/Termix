import React, { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  ArrowLeftRight,
  FileText,
} from "lucide-react";
import {
  readSSHFile,
  downloadSSHFile,
  getSSHStatus,
  connectSSH,
} from "@/ui/main-axios";
import type { FileItem, SSHHost } from "../../../../types/index.js";

interface DiffViewerProps {
  file1: FileItem;
  file2: FileItem;
  sshSessionId: string;
  sshHost: SSHHost;
  onDownload1?: () => void;
  onDownload2?: () => void;
}

export function DiffViewer({
  file1,
  file2,
  sshSessionId,
  sshHost,
  onDownload1,
  onDownload2,
}: DiffViewerProps) {
  const [content1, setContent1] = useState<string>("");
  const [content2, setContent2] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<"side-by-side" | "inline">(
    "side-by-side",
  );
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  // 确保SSH连接有效
  const ensureSSHConnection = async () => {
    try {
      const status = await getSSHStatus(sshSessionId);
      if (!status.connected) {
        await connectSSH(sshSessionId, {
          hostId: sshHost.id,
          ip: sshHost.ip,
          port: sshHost.port,
          username: sshHost.username,
          password: sshHost.password,
          sshKey: sshHost.key,
          keyPassword: sshHost.keyPassword,
          authType: sshHost.authType,
          credentialId: sshHost.credentialId,
          userId: sshHost.userId,
        });
      }
    } catch (error) {
      console.error("SSH connection check/reconnect failed:", error);
      throw error;
    }
  };

  // 加载文件内容
  const loadFileContents = async () => {
    if (file1.type !== "file" || file2.type !== "file") {
      setError("只能对比文件类型的项目");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // 确保SSH连接有效
      await ensureSSHConnection();

      // 并行加载两个文件
      const [response1, response2] = await Promise.all([
        readSSHFile(sshSessionId, file1.path),
        readSSHFile(sshSessionId, file2.path),
      ]);

      setContent1(response1.content || "");
      setContent2(response2.content || "");
    } catch (error: any) {
      console.error("Failed to load files for diff:", error);

      const errorData = error?.response?.data;
      if (errorData?.tooLarge) {
        setError(`文件过大: ${errorData.error}`);
      } else if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        setError(
          `SSH连接失败。请检查与 ${sshHost.name} (${sshHost.ip}:${sshHost.port}) 的连接`,
        );
      } else {
        setError(
          `加载文件失败: ${error.message || errorData?.error || "未知错误"}`,
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 下载文件
  const handleDownloadFile = async (file: FileItem) => {
    try {
      await ensureSSHConnection();
      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        const byteCharacters = atob(response.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {
          type: response.mimeType || "application/octet-stream",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = response.fileName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(`文件下载成功: ${file.name}`);
      }
    } catch (error: any) {
      console.error("Failed to download file:", error);
      toast.error(`下载失败: ${error.message || "未知错误"}`);
    }
  };

  // 获取文件语言类型
  const getFileLanguage = (fileName: string): string => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
      php: "php",
      rb: "ruby",
      go: "go",
      rs: "rust",
      html: "html",
      css: "css",
      scss: "scss",
      less: "less",
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sql: "sql",
      sh: "shell",
      bash: "shell",
      ps1: "powershell",
      dockerfile: "dockerfile",
    };
    return languageMap[ext || ""] || "plaintext";
  };

  // 初始加载
  useEffect(() => {
    loadFileContents();
  }, [file1, file2, sshSessionId]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-dark-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">正在加载文件对比...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-dark-bg">
        <div className="text-center max-w-md">
          <FileText className="w-16 h-16 mx-auto mb-4 text-red-500 opacity-50" />
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={loadFileContents} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            重新加载
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-bg">
      {/* 工具栏 */}
      <div className="flex-shrink-0 border-b border-dark-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-muted-foreground">对比：</span>
              <span className="font-medium text-green-400 mx-2">
                {file1.name}
              </span>
              <ArrowLeftRight className="w-4 h-4 inline mx-1" />
              <span className="font-medium text-blue-400">{file2.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 视图切换 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDiffMode(
                  diffMode === "side-by-side" ? "inline" : "side-by-side",
                )
              }
            >
              {diffMode === "side-by-side" ? "并排" : "内联"}
            </Button>

            {/* 行号切换 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLineNumbers(!showLineNumbers)}
            >
              {showLineNumbers ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </Button>

            {/* 下载按钮 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadFile(file1)}
              title={`下载 ${file1.name}`}
            >
              <Download className="w-4 h-4 mr-1" />
              {file1.name}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadFile(file2)}
              title={`下载 ${file2.name}`}
            >
              <Download className="w-4 h-4 mr-1" />
              {file2.name}
            </Button>

            {/* 刷新按钮 */}
            <Button variant="outline" size="sm" onClick={loadFileContents}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Diff编辑器 */}
      <div className="flex-1">
        <DiffEditor
          original={content1}
          modified={content2}
          language={getFileLanguage(file1.name)}
          theme="vs-dark"
          options={{
            renderSideBySide: diffMode === "side-by-side",
            lineNumbers: showLineNumbers ? "on" : "off",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            wordWrap: "off",
            automaticLayout: true,
            readOnly: true,
            originalEditable: false,
            modifiedEditable: false,
            scrollbar: {
              vertical: "visible",
              horizontal: "visible",
            },
            diffWordWrap: "off",
            ignoreTrimWhitespace: false,
          }}
          loading={
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">初始化编辑器...</p>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
