import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
  SidebarGroupLabel,
} from "@/components/ui/sidebar.tsx";
import {
  Plus,
  Play,
  Edit,
  Trash2,
  Copy,
  X,
  RotateCcw,
  Search,
  Loader2,
  Terminal,
  LayoutGrid,
  MonitorCheck,
  Folder,
  ChevronDown,
  ChevronRight,
  GripVertical,
  FolderPlus,
  Settings,
  MoreVertical,
  Server,
  Cloud,
  Database,
  Box,
  Package,
  Layers,
  Archive,
  HardDrive,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  getCookie,
  setCookie,
  getCommandHistory,
  deleteCommandFromHistory,
  getSnippetFolders,
  createSnippetFolder,
  updateSnippetFolderMetadata,
  renameSnippetFolder,
  deleteSnippetFolder,
  reorderSnippets,
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import type { Snippet, SnippetData, SnippetFolder } from "../../../../types";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      sendInput?: (data: string) => void;
    };
  };
  hostConfig?: {
    id: number;
  };
  isActive?: boolean;
  [key: string]: unknown;
}

interface SSHToolsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSnippetExecute: (content: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  initialTab?: string;
  onTabChange?: () => void;
}

const AVAILABLE_COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#6b7280", label: "Gray" },
];

const AVAILABLE_ICONS = [
  { value: "Folder", label: "Folder", Icon: Folder },
  { value: "Server", label: "Server", Icon: Server },
  { value: "Cloud", label: "Cloud", Icon: Cloud },
  { value: "Database", label: "Database", Icon: Database },
  { value: "Box", label: "Box", Icon: Box },
  { value: "Package", label: "Package", Icon: Package },
  { value: "Layers", label: "Layers", Icon: Layers },
  { value: "Archive", label: "Archive", Icon: Archive },
  { value: "HardDrive", label: "HardDrive", Icon: HardDrive },
  { value: "Globe", label: "Globe", Icon: Globe },
];

export function SSHToolsSidebar({
  isOpen,
  onClose,
  onSnippetExecute,
  sidebarWidth,
  setSidebarWidth,
  initialTab,
  onTabChange,
}: SSHToolsSidebarProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const {
    tabs,
    currentTab,
    allSplitScreenTab,
    setSplitScreenTab,
    setCurrentTab,
  } = useTabs() as {
    tabs: TabData[];
    currentTab: number | null;
    allSplitScreenTab: number[];
    setSplitScreenTab: (tabId: number) => void;
    setCurrentTab: (tabId: number) => void;
  };
  const [activeTab, setActiveTab] = useState(initialTab || "ssh-tools");

  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (onTabChange) {
      onTabChange();
    }
  };

  const [isRecording, setIsRecording] = useState(false);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [rightClickCopyPaste, setRightClickCopyPaste] = useState<boolean>(
    () => getCookie("rightClickCopyPaste") === "true",
  );

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetFolders, setSnippetFolders] = useState<SnippetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [formData, setFormData] = useState<SnippetData>({
    name: "",
    content: "",
    description: "",
  });
  const [formErrors, setFormErrors] = useState({
    name: false,
    content: false,
  });
  const [selectedSnippetTabIds, setSelectedSnippetTabIds] = useState<number[]>(
    [],
  );
  const [draggedSnippet, setDraggedSnippet] = useState<Snippet | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    const shouldCollapse =
      localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false";
    return shouldCollapse ? new Set() : new Set();
  });
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [editingFolder, setEditingFolder] = useState<SnippetFolder | null>(
    null,
  );
  const [folderFormData, setFolderFormData] = useState({
    name: "",
    color: "",
    icon: "",
  });
  const [folderFormErrors, setFolderFormErrors] = useState({
    name: false,
  });

  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [historyRefreshCounter, setHistoryRefreshCounter] = useState(0);
  const commandHistoryScrollRef = React.useRef<HTMLDivElement>(null);

  const [splitMode, setSplitMode] = useState<"none" | "2" | "3" | "4">("none");
  const [splitAssignments, setSplitAssignments] = useState<Map<number, number>>(
    new Map(),
  );
  const [previewKey, setPreviewKey] = useState(0);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [dragOverCellIndex, setDragOverCellIndex] = useState<number | null>(
    null,
  );

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = React.useRef<number | null>(null);
  const startWidthRef = React.useRef<number>(sidebarWidth);

  const terminalTabs = tabs.filter((tab: TabData) => tab.type === "terminal");
  const activeUiTab = tabs.find((tab) => tab.id === currentTab);
  const activeTerminal =
    activeUiTab?.type === "terminal" ? activeUiTab : undefined;
  const activeTerminalHostId = activeTerminal?.hostConfig?.id;

  const splittableTabs = tabs.filter(
    (tab: TabData) =>
      tab.type === "terminal" ||
      tab.type === "server" ||
      tab.type === "file_manager" ||
      tab.type === "user_profile",
  );

  useEffect(() => {
    let cancelled = false;

    if (isOpen && activeTab === "command-history") {
      if (activeTerminalHostId) {
        const scrollTop = commandHistoryScrollRef.current?.scrollTop || 0;
        setIsHistoryLoading(true);
        setHistoryError(null);

        getCommandHistory(activeTerminalHostId)
          .then((history) => {
            if (cancelled) return;

            setCommandHistory((prevHistory) => {
              const newHistory = Array.isArray(history) ? history : [];
              if (JSON.stringify(prevHistory) !== JSON.stringify(newHistory)) {
                requestAnimationFrame(() => {
                  if (commandHistoryScrollRef.current) {
                    commandHistoryScrollRef.current.scrollTop = scrollTop;
                  }
                });
                return newHistory;
              }
              return prevHistory;
            });
            setIsHistoryLoading(false);
          })
          .catch((err) => {
            if (cancelled) return;

            console.error("Failed to fetch command history", err);
            const errorMessage =
              err?.response?.status === 401
                ? "Authentication required. Please refresh the page."
                : err?.response?.status === 403
                  ? "Data access locked. Please re-authenticate."
                  : err?.message || "Failed to load command history";

            setHistoryError(errorMessage);
            setCommandHistory([]);
            setIsHistoryLoading(false);
          });
      } else {
        setCommandHistory([]);
        setHistoryError(null);
        setIsHistoryLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    activeTab,
    activeTerminalHostId,
    currentTab,
    historyRefreshCounter,
  ]);

  useEffect(() => {
    if (isOpen && activeTab === "command-history" && activeTerminalHostId) {
      const refreshInterval = setInterval(() => {
        setHistoryRefreshCounter((prev) => prev + 1);
      }, 2000);

      return () => clearInterval(refreshInterval);
    }
  }, [isOpen, activeTab, activeTerminalHostId]);

  const filteredCommands = searchQuery
    ? commandHistory.filter((cmd) =>
        cmd.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : commandHistory;

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--right-sidebar-width",
      `${sidebarWidth}px`,
    );
  }, [sidebarWidth]);

  useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
      const maxWidth = Math.floor(window.innerWidth * 0.3);
      if (sidebarWidth > maxWidth) {
        setSidebarWidth(Math.max(minWidth, maxWidth));
      } else if (sidebarWidth < minWidth) {
        setSidebarWidth(minWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarWidth, setSidebarWidth]);

  useEffect(() => {
    if (isOpen && activeTab === "snippets") {
      fetchSnippets();
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (snippetFolders.length > 0) {
      const shouldCollapse =
        localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false";
      if (shouldCollapse) {
        const allFolderNames = new Set(snippetFolders.map((f) => f.name));
        const uncategorizedSnippets = snippets.filter(
          (s) => !s.folder || s.folder === "",
        );
        if (uncategorizedSnippets.length > 0) {
          allFolderNames.add("");
        }
        setCollapsedFolders(allFolderNames);
      } else {
        setCollapsedFolders(new Set());
      }
    }
  }, [snippetFolders, snippets]);

  useEffect(() => {
    const handleSettingChange = () => {
      const shouldCollapse =
        localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false";
      if (shouldCollapse) {
        const allFolderNames = new Set(snippetFolders.map((f) => f.name));
        const uncategorizedSnippets = snippets.filter(
          (s) => !s.folder || s.folder === "",
        );
        if (uncategorizedSnippets.length > 0) {
          allFolderNames.add("");
        }
        setCollapsedFolders(allFolderNames);
      } else {
        setCollapsedFolders(new Set());
      }
    };

    window.addEventListener(
      "defaultSnippetFoldersCollapsedChanged",
      handleSettingChange,
    );
    return () => {
      window.removeEventListener(
        "defaultSnippetFoldersCollapsedChanged",
        handleSettingChange,
      );
    };
  }, [snippetFolders, snippets]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (startXRef.current == null) return;
      const dx = startXRef.current - e.clientX;
      const newWidth = Math.round(startWidthRef.current + dx);
      const minWidth = Math.min(300, Math.floor(window.innerWidth * 0.2));
      const maxWidth = Math.round(window.innerWidth * 0.3);

      let finalWidth = newWidth;
      if (newWidth < minWidth) {
        finalWidth = minWidth;
      } else if (newWidth > maxWidth) {
        finalWidth = maxWidth;
      }

      document.documentElement.style.setProperty(
        "--right-sidebar-width",
        `${finalWidth}px`,
      );

      setSidebarWidth(finalWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      startXRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleTabToggle = (tabId: number) => {
    setSelectedTabIds((prev) =>
      prev.includes(tabId)
        ? prev.filter((id) => id !== tabId)
        : [...prev, tabId],
    );
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    setTimeout(() => {
      const input = document.getElementById(
        "ssh-tools-input",
      ) as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setSelectedTabIds([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (selectedTabIds.length === 0) return;

    let commandToSend = "";

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "c") {
        commandToSend = "\x03";
        e.preventDefault();
      } else if (e.key === "d") {
        commandToSend = "\x04";
        e.preventDefault();
      } else if (e.key === "l") {
        commandToSend = "\x0c";
        e.preventDefault();
      } else if (e.key === "u") {
        commandToSend = "\x15";
        e.preventDefault();
      } else if (e.key === "k") {
        commandToSend = "\x0b";
        e.preventDefault();
      } else if (e.key === "a") {
        commandToSend = "\x01";
        e.preventDefault();
      } else if (e.key === "e") {
        commandToSend = "\x05";
        e.preventDefault();
      } else if (e.key === "w") {
        commandToSend = "\x17";
        e.preventDefault();
      }
    } else if (e.key === "Enter") {
      commandToSend = "\n";
      e.preventDefault();
    } else if (e.key === "Backspace") {
      commandToSend = "\x08";
      e.preventDefault();
    } else if (e.key === "Delete") {
      commandToSend = "\x7f";
      e.preventDefault();
    } else if (e.key === "Tab") {
      commandToSend = "\x09";
      e.preventDefault();
    } else if (e.key === "Escape") {
      commandToSend = "\x1b";
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      commandToSend = "\x1b[A";
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      commandToSend = "\x1b[B";
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      commandToSend = "\x1b[D";
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      commandToSend = "\x1b[C";
      e.preventDefault();
    } else if (e.key === "Home") {
      commandToSend = "\x1b[H";
      e.preventDefault();
    } else if (e.key === "End") {
      commandToSend = "\x1b[F";
      e.preventDefault();
    } else if (e.key === "PageUp") {
      commandToSend = "\x1b[5~";
      e.preventDefault();
    } else if (e.key === "PageDown") {
      commandToSend = "\x1b[6~";
      e.preventDefault();
    } else if (e.key === "Insert") {
      commandToSend = "\x1b[2~";
      e.preventDefault();
    } else if (e.key === "F1") {
      commandToSend = "\x1bOP";
      e.preventDefault();
    } else if (e.key === "F2") {
      commandToSend = "\x1bOQ";
      e.preventDefault();
    } else if (e.key === "F3") {
      commandToSend = "\x1bOR";
      e.preventDefault();
    } else if (e.key === "F4") {
      commandToSend = "\x1bOS";
      e.preventDefault();
    } else if (e.key === "F5") {
      commandToSend = "\x1b[15~";
      e.preventDefault();
    } else if (e.key === "F6") {
      commandToSend = "\x1b[17~";
      e.preventDefault();
    } else if (e.key === "F7") {
      commandToSend = "\x1b[18~";
      e.preventDefault();
    } else if (e.key === "F8") {
      commandToSend = "\x1b[19~";
      e.preventDefault();
    } else if (e.key === "F9") {
      commandToSend = "\x1b[20~";
      e.preventDefault();
    } else if (e.key === "F10") {
      commandToSend = "\x1b[21~";
      e.preventDefault();
    } else if (e.key === "F11") {
      commandToSend = "\x1b[23~";
      e.preventDefault();
    } else if (e.key === "F12") {
      commandToSend = "\x1b[24~";
      e.preventDefault();
    }

    if (commandToSend) {
      selectedTabIds.forEach((tabId) => {
        const tab = tabs.find((t: TabData) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(commandToSend);
        }
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (selectedTabIds.length === 0) return;

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const char = e.key;
      selectedTabIds.forEach((tabId) => {
        const tab = tabs.find((t: TabData) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(char);
        }
      });
    }
  };

  const updateRightClickCopyPaste = (checked: boolean) => {
    setCookie("rightClickCopyPaste", checked.toString());
    setRightClickCopyPaste(checked);
  };

  const fetchSnippets = async () => {
    try {
      setLoading(true);
      const [snippetsData, foldersData] = await Promise.all([
        getSnippets(),
        getSnippetFolders(),
      ]);
      setSnippets(Array.isArray(snippetsData) ? snippetsData : []);
      setSnippetFolders(Array.isArray(foldersData) ? foldersData : []);
    } catch {
      toast.error(t("snippets.failedToFetch"));
      setSnippets([]);
      setSnippetFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingSnippet(null);
    setFormData({ name: "", content: "", description: "" });
    setFormErrors({ name: false, content: false });
    setShowDialog(true);
  };

  const handleEdit = (snippet: Snippet) => {
    setEditingSnippet(snippet);
    setFormData({
      name: snippet.name,
      content: snippet.content,
      description: snippet.description || "",
      folder: snippet.folder,
    });
    setFormErrors({ name: false, content: false });
    setShowDialog(true);
  };

  const handleDelete = (snippet: Snippet) => {
    confirmWithToast(
      t("snippets.deleteConfirmDescription", { name: snippet.name }),
      async () => {
        try {
          await deleteSnippet(snippet.id);
          toast.success(t("snippets.deleteSuccess"));
          fetchSnippets();
        } catch {
          toast.error(t("snippets.deleteFailed"));
        }
      },
      "destructive",
    );
  };

  const handleSubmit = async () => {
    const errors = {
      name: !formData.name.trim(),
      content: !formData.content.trim(),
    };

    setFormErrors(errors);

    if (errors.name || errors.content) {
      return;
    }

    try {
      if (editingSnippet) {
        await updateSnippet(editingSnippet.id, formData);
        toast.success(t("snippets.updateSuccess"));
      } else {
        await createSnippet(formData);
        toast.success(t("snippets.createSuccess"));
      }
      setShowDialog(false);
      fetchSnippets();
    } catch {
      toast.error(
        editingSnippet
          ? t("snippets.updateFailed")
          : t("snippets.createFailed"),
      );
    }
  };

  const handleSnippetTabToggle = (tabId: number) => {
    setSelectedSnippetTabIds((prev) =>
      prev.includes(tabId)
        ? prev.filter((id) => id !== tabId)
        : [...prev, tabId],
    );
  };

  const handleExecute = (snippet: Snippet) => {
    if (selectedSnippetTabIds.length > 0) {
      selectedSnippetTabIds.forEach((tabId) => {
        const tab = tabs.find((t: TabData) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(snippet.content + "\n");
        }
      });
      toast.success(
        t("snippets.executeSuccess", {
          name: snippet.name,
          count: selectedSnippetTabIds.length,
        }),
      );
    } else {
      onSnippetExecute(snippet.content);
      toast.success(t("snippets.executeSuccess", { name: snippet.name }));
    }

    // Remove focus from any active element in the sidebar to prevent accidental re-execution
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleCopy = (snippet: Snippet) => {
    navigator.clipboard.writeText(snippet.content);
    toast.success(t("snippets.copySuccess", { name: snippet.name }));
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  const getFolderIcon = (folderName: string) => {
    const metadata = snippetFolders.find((f) => f.name === folderName);
    if (!metadata?.icon) return Folder;

    const iconData = AVAILABLE_ICONS.find((i) => i.value === metadata.icon);
    return iconData?.Icon || Folder;
  };

  const getFolderColor = (folderName: string) => {
    const metadata = snippetFolders.find((f) => f.name === folderName);
    return metadata?.color;
  };

  const groupSnippetsByFolder = () => {
    const grouped = new Map<string, Snippet[]>();

    snippetFolders.forEach((folder) => {
      if (!grouped.has(folder.name)) {
        grouped.set(folder.name, []);
      }
    });

    snippets.forEach((snippet) => {
      const folderName = snippet.folder || "";
      if (!grouped.has(folderName)) {
        grouped.set(folderName, []);
      }
      grouped.get(folderName)!.push(snippet);
    });

    return grouped;
  };

  const handleDragStart = (e: React.DragEvent, snippet: Snippet) => {
    setDraggedSnippet(snippet);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetSnippet: Snippet) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnterFolder = (folderName: string) => {
    setDragOverFolder(folderName);
  };

  const handleDragLeaveFolder = () => {
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetSnippet: Snippet) => {
    e.preventDefault();

    if (!draggedSnippet || draggedSnippet.id === targetSnippet.id) {
      setDraggedSnippet(null);
      setDragOverFolder(null);
      return;
    }

    const sourceFolder = draggedSnippet.folder || "";
    const targetFolder = targetSnippet.folder || "";

    if (sourceFolder !== targetFolder) {
      toast.error(
        t("snippets.reorderSameFolder", {
          defaultValue: "Can only reorder snippets within the same folder",
        }),
      );
      setDraggedSnippet(null);
      setDragOverFolder(null);
      return;
    }

    const folderSnippets = snippets.filter(
      (s) => (s.folder || "") === targetFolder,
    );

    const draggedIndex = folderSnippets.findIndex(
      (s) => s.id === draggedSnippet.id,
    );
    const targetIndex = folderSnippets.findIndex(
      (s) => s.id === targetSnippet.id,
    );

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedSnippet(null);
      setDragOverFolder(null);
      return;
    }

    const reorderedSnippets = [...folderSnippets];
    reorderedSnippets.splice(draggedIndex, 1);
    reorderedSnippets.splice(targetIndex, 0, draggedSnippet);

    const updates = reorderedSnippets.map((snippet, index) => ({
      id: snippet.id,
      order: index,
      folder: targetFolder || undefined,
    }));

    try {
      await reorderSnippets(updates);
      toast.success(
        t("snippets.reorderSuccess", {
          defaultValue: "Snippets reordered successfully",
        }),
      );
      fetchSnippets();
    } catch {
      toast.error(
        t("snippets.reorderFailed", {
          defaultValue: "Failed to reorder snippets",
        }),
      );
    }

    setDraggedSnippet(null);
    setDragOverFolder(null);
  };

  const handleDragEnd = () => {
    setDraggedSnippet(null);
    setDragOverFolder(null);
  };

  const handleCreateFolder = () => {
    setEditingFolder(null);
    setFolderFormData({
      name: "",
      color: AVAILABLE_COLORS[0].value,
      icon: AVAILABLE_ICONS[0].value,
    });
    setFolderFormErrors({ name: false });
    setShowFolderDialog(true);
  };

  const handleEditFolder = (folder: SnippetFolder) => {
    setEditingFolder(folder);
    setFolderFormData({
      name: folder.name,
      color: folder.color || AVAILABLE_COLORS[0].value,
      icon: folder.icon || AVAILABLE_ICONS[0].value,
    });
    setFolderFormErrors({ name: false });
    setShowFolderDialog(true);
  };

  const handleDeleteFolder = (folderName: string) => {
    confirmWithToast(
      t("snippets.deleteFolderConfirm", {
        name: folderName,
        defaultValue: `Delete folder "${folderName}"? All snippets will be moved to Uncategorized.`,
      }),
      async () => {
        try {
          await deleteSnippetFolder(folderName);
          toast.success(
            t("snippets.deleteFolderSuccess", {
              defaultValue: "Folder deleted successfully",
            }),
          );
          fetchSnippets();
        } catch {
          toast.error(
            t("snippets.deleteFolderFailed", {
              defaultValue: "Failed to delete folder",
            }),
          );
        }
      },
      "destructive",
    );
  };

  const handleFolderSubmit = async () => {
    const errors = {
      name: !folderFormData.name.trim(),
    };

    setFolderFormErrors(errors);

    if (errors.name) {
      return;
    }

    try {
      if (editingFolder) {
        if (editingFolder.name !== folderFormData.name) {
          await renameSnippetFolder(editingFolder.name, folderFormData.name);
        }
        await updateSnippetFolderMetadata(folderFormData.name, {
          color: folderFormData.color || undefined,
          icon: folderFormData.icon || undefined,
        });
        toast.success(
          t("snippets.updateFolderSuccess", {
            defaultValue: "Folder updated successfully",
          }),
        );
      } else {
        await createSnippetFolder({
          name: folderFormData.name,
          color: folderFormData.color || undefined,
          icon: folderFormData.icon || undefined,
        });
        toast.success(
          t("snippets.createFolderSuccess", {
            defaultValue: "Folder created successfully",
          }),
        );
      }

      setShowFolderDialog(false);
      fetchSnippets();
    } catch {
      toast.error(
        editingFolder
          ? t("snippets.updateFolderFailed", {
              defaultValue: "Failed to update folder",
            })
          : t("snippets.createFolderFailed", {
              defaultValue: "Failed to create folder",
            }),
      );
    }
  };

  const handleSplitModeChange = (mode: "none" | "2" | "3" | "4") => {
    setSplitMode(mode);

    if (mode === "none") {
      handleClearSplit();
    } else {
      setSplitAssignments(new Map());
      setPreviewKey((prev) => prev + 1);
    }
  };

  const handleTabDragStart = (tabId: number) => {
    setDraggedTabId(tabId);
  };

  const handleTabDragEnd = () => {
    setDraggedTabId(null);
    setDragOverCellIndex(null);
  };

  const handleTabDragOver = (e: React.DragEvent, cellIndex: number) => {
    e.preventDefault();
    setDragOverCellIndex(cellIndex);
  };

  const handleTabDragLeave = () => {
    setDragOverCellIndex(null);
  };

  const handleTabDrop = (cellIndex: number) => {
    if (draggedTabId === null) return;

    setSplitAssignments((prev) => {
      const newMap = new Map(prev);
      Array.from(newMap.entries()).forEach(([idx, id]) => {
        if (id === draggedTabId && idx !== cellIndex) {
          newMap.delete(idx);
        }
      });
      newMap.set(cellIndex, draggedTabId);
      return newMap;
    });

    setDraggedTabId(null);
    setDragOverCellIndex(null);
    setPreviewKey((prev) => prev + 1);
  };

  const handleRemoveFromCell = (cellIndex: number) => {
    setSplitAssignments((prev) => {
      const newMap = new Map(prev);
      newMap.delete(cellIndex);
      setPreviewKey((prev) => prev + 1);
      return newMap;
    });
  };

  const handleApplySplit = () => {
    if (splitMode === "none") {
      handleClearSplit();
      return;
    }

    if (splitAssignments.size === 0) {
      toast.error(
        t("splitScreen.error.noAssignments", {
          defaultValue: "Please drag tabs to cells before applying",
        }),
      );
      return;
    }

    const requiredSlots = parseInt(splitMode);

    if (splitAssignments.size < requiredSlots) {
      toast.error(
        t("splitScreen.error.fillAllSlots", {
          defaultValue: `Please fill all ${requiredSlots} layout spots before applying`,
          count: requiredSlots,
        }),
      );
      return;
    }

    const orderedTabIds: number[] = [];
    for (let i = 0; i < requiredSlots; i++) {
      const tabId = splitAssignments.get(i);
      if (tabId !== undefined) {
        orderedTabIds.push(tabId);
      }
    }

    const currentSplits = [...allSplitScreenTab];
    currentSplits.forEach((tabId) => {
      setSplitScreenTab(tabId);
    });

    orderedTabIds.forEach((tabId) => {
      setSplitScreenTab(tabId);
    });

    if (!orderedTabIds.includes(currentTab ?? 0)) {
      setCurrentTab(orderedTabIds[0]);
    }

    toast.success(
      t("splitScreen.success", {
        defaultValue: "Split screen applied",
      }),
    );
  };

  const handleClearSplit = () => {
    allSplitScreenTab.forEach((tabId) => {
      setSplitScreenTab(tabId);
    });

    setSplitMode("none");
    setSplitAssignments(new Map());
    setPreviewKey((prev) => prev + 1);

    toast.success(
      t("splitScreen.cleared", {
        defaultValue: "Split screen cleared",
      }),
    );
  };

  const handleResetToSingle = () => {
    handleClearSplit();
  };

  const handleCommandSelect = (command: string) => {
    if (activeTerminal?.terminalRef?.current?.sendInput) {
      activeTerminal.terminalRef.current.sendInput(command);
    }
  };

  const handleCommandDelete = async (command: string) => {
    if (activeTerminalHostId) {
      try {
        await deleteCommandFromHistory(activeTerminalHostId, command);
        setCommandHistory((prev) => prev.filter((c) => c !== command));
        toast.success(
          t("commandHistory.deleteSuccess", {
            defaultValue: "Command deleted from history",
          }),
        );
      } catch {
        toast.error(
          t("commandHistory.deleteFailed", {
            defaultValue: "Failed to delete command.",
          }),
        );
      }
    }
  };

  return (
    <>
      {isOpen && (
        <div className="fixed top-0 right-0 h-0 w-0 pointer-events-none">
          <SidebarProvider
            open={isOpen}
            style={
              { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
            }
            className="!min-h-0 !h-0 !w-0"
          >
            <Sidebar
              variant="floating"
              side="right"
              className="pointer-events-auto"
            >
              <SidebarHeader>
                <SidebarGroupLabel className="text-lg font-bold text-white">
                  {t("nav.tools")}
                  <div className="absolute right-5 flex gap-1">
                    <Button
                      variant="outline"
                      onClick={() => setSidebarWidth(400)}
                      className="w-[28px] h-[28px]"
                      title="Reset sidebar width"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onClose}
                      className="w-[28px] h-[28px]"
                      title={t("common.close")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </SidebarGroupLabel>
              </SidebarHeader>
              <Separator className="p-0.25" />
              <SidebarContent className="p-4 flex flex-col overflow-hidden">
                <Tabs
                  value={activeTab}
                  onValueChange={handleTabChange}
                  className="flex flex-col h-full overflow-hidden"
                >
                  <TabsList className="w-full grid grid-cols-4 mb-4 flex-shrink-0">
                    <TabsTrigger value="ssh-tools">
                      {t("sshTools.title")}
                    </TabsTrigger>
                    <TabsTrigger value="snippets">
                      {t("snippets.title")}
                    </TabsTrigger>
                    <TabsTrigger value="command-history">
                      {t("commandHistory.title", { defaultValue: "History" })}
                    </TabsTrigger>
                    <TabsTrigger value="split-screen">
                      {t("splitScreen.title", { defaultValue: "Split Screen" })}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="ssh-tools" className="space-y-4">
                    <h3 className="font-semibold text-white">
                      {t("sshTools.keyRecording")}
                    </h3>

                    <div className="space-y-4">
                      <div className="flex gap-2">
                        {!isRecording ? (
                          <Button
                            onClick={handleStartRecording}
                            className="flex-1"
                            variant="outline"
                          >
                            {t("sshTools.startKeyRecording")}
                          </Button>
                        ) : (
                          <Button
                            onClick={handleStopRecording}
                            className="flex-1"
                            variant="destructive"
                          >
                            {t("sshTools.stopKeyRecording")}
                          </Button>
                        )}
                      </div>

                      {isRecording && (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-white">
                              {t("sshTools.selectTerminals")}
                            </label>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                              {terminalTabs.map((tab) => (
                                <Button
                                  key={tab.id}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className={`rounded-full px-3 py-1 text-xs flex items-center gap-1 ${
                                    selectedTabIds.includes(tab.id)
                                      ? "text-white bg-gray-700"
                                      : "text-gray-500"
                                  }`}
                                  onClick={() => handleTabToggle(tab.id)}
                                >
                                  {tab.title}
                                </Button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-white">
                              {t("sshTools.typeCommands")}
                            </label>
                            <Input
                              id="ssh-tools-input"
                              placeholder={t("placeholders.typeHere")}
                              onKeyDown={handleKeyDown}
                              onKeyPress={handleKeyPress}
                              className="font-mono"
                              disabled={selectedTabIds.length === 0}
                              readOnly
                            />
                            <p className="text-xs text-muted-foreground">
                              {t("sshTools.commandsWillBeSent", {
                                count: selectedTabIds.length,
                              })}
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    <Separator />

                    <h3 className="font-semibold text-white">
                      {t("sshTools.settings")}
                    </h3>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="enable-copy-paste"
                        onCheckedChange={updateRightClickCopyPaste}
                        checked={rightClickCopyPaste}
                      />
                      <label
                        htmlFor="enable-copy-paste"
                        className="text-sm font-medium leading-none text-white cursor-pointer"
                      >
                        {t("sshTools.enableRightClickCopyPaste")}
                      </label>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="snippets"
                    className="space-y-4 flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="flex-shrink-0 space-y-4">
                      {terminalTabs.length > 0 && (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-white">
                              {t("snippets.selectTerminals", {
                                defaultValue: "Select Terminals (optional)",
                              })}
                            </label>
                            <p className="text-xs text-muted-foreground">
                              {selectedSnippetTabIds.length > 0
                                ? t("snippets.executeOnSelected", {
                                    defaultValue: `Execute on ${selectedSnippetTabIds.length} selected terminal(s)`,
                                    count: selectedSnippetTabIds.length,
                                  })
                                : t("snippets.executeOnCurrent", {
                                    defaultValue:
                                      "Execute on current terminal (click to select multiple)",
                                  })}
                            </p>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                              {terminalTabs.map((tab) => (
                                <Button
                                  key={tab.id}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className={`rounded-full px-3 py-1 text-xs flex items-center gap-1 ${
                                    selectedSnippetTabIds.includes(tab.id)
                                      ? "text-white bg-gray-700"
                                      : "text-gray-500"
                                  }`}
                                  onClick={() => handleSnippetTabToggle(tab.id)}
                                >
                                  {tab.title}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <Separator />
                        </>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={handleCreate}
                          className="flex-1"
                          variant="outline"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          {t("snippets.new")}
                        </Button>
                        <Button
                          onClick={handleCreateFolder}
                          className="flex-1"
                          variant="outline"
                        >
                          <FolderPlus className="w-4 h-4 mr-2" />
                          {t("snippets.newFolder", {
                            defaultValue: "New Folder",
                          })}
                        </Button>
                      </div>
                    </div>

                    {loading ? (
                      <div className="text-center text-muted-foreground py-8 flex-1">
                        <p>{t("common.loading")}</p>
                      </div>
                    ) : snippets.length === 0 && snippetFolders.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8 flex-1">
                        <p className="mb-2 font-medium">
                          {t("snippets.empty")}
                        </p>
                        <p className="text-sm">{t("snippets.emptyHint")}</p>
                      </div>
                    ) : (
                      <TooltipProvider>
                        <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
                          {Array.from(groupSnippetsByFolder()).map(
                            ([folderName, folderSnippets]) => {
                              const folderMetadata = snippetFolders.find(
                                (f) => f.name === folderName,
                              );
                              const isCollapsed =
                                collapsedFolders.has(folderName);

                              return (
                                <div key={folderName || "uncategorized"}>
                                  <div className="flex items-center gap-2 mb-2 hover:bg-dark-hover-alt p-2 rounded-lg transition-colors group/folder">
                                    <div
                                      className="flex items-center gap-2 flex-1 cursor-pointer"
                                      onClick={() => toggleFolder(folderName)}
                                    >
                                      {isCollapsed ? (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                      )}
                                      {(() => {
                                        const FolderIcon =
                                          getFolderIcon(folderName);
                                        const folderColor =
                                          getFolderColor(folderName);
                                        return (
                                          <FolderIcon
                                            className="h-4 w-4"
                                            style={{
                                              color: folderColor || undefined,
                                            }}
                                          />
                                        );
                                      })()}
                                      <span
                                        className="text-sm font-semibold"
                                        style={{
                                          color:
                                            getFolderColor(folderName) ||
                                            undefined,
                                        }}
                                      >
                                        {folderName ||
                                          t("snippets.uncategorized", {
                                            defaultValue: "Uncategorized",
                                          })}
                                      </span>
                                      <span className="text-xs text-muted-foreground ml-auto">
                                        {folderSnippets.length}
                                      </span>
                                    </div>
                                    {folderName && (
                                      <div className="flex items-center gap-1 opacity-0 group-hover/folder:opacity-100 transition-opacity">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 w-6 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditFolder(
                                              folderMetadata || {
                                                id: 0,
                                                userId: "",
                                                name: folderName,
                                                createdAt: "",
                                                updatedAt: "",
                                              },
                                            );
                                          }}
                                        >
                                          <Settings className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteFolder(folderName);
                                          }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>

                                  {!isCollapsed && (
                                    <div className="space-y-2 ml-6">
                                      {folderSnippets.map((snippet) => (
                                        <div
                                          key={snippet.id}
                                          draggable
                                          onDragStart={(e) =>
                                            handleDragStart(e, snippet)
                                          }
                                          onDragOver={(e) =>
                                            handleDragOver(e, snippet)
                                          }
                                          onDrop={(e) => handleDrop(e, snippet)}
                                          onDragEnd={handleDragEnd}
                                          className={`bg-dark-bg-input border border-input rounded-lg cursor-move hover:shadow-lg hover:border-gray-400/50 hover:bg-dark-hover-alt transition-all duration-200 p-3 group ${
                                            draggedSnippet?.id === snippet.id
                                              ? "opacity-50"
                                              : ""
                                          }`}
                                        >
                                          <div className="mb-2 flex items-center gap-2">
                                            <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                                            <div className="flex-1 min-w-0">
                                              <h3 className="text-sm font-medium text-white mb-1">
                                                {snippet.name}
                                              </h3>
                                              {snippet.description && (
                                                <p className="text-xs text-muted-foreground">
                                                  {snippet.description}
                                                </p>
                                              )}
                                              <p className="text-xs text-muted-foreground mt-1">
                                                ID: {snippet.id}
                                              </p>
                                            </div>
                                          </div>

                                          <div className="bg-muted/30 rounded p-2 mb-3">
                                            <code className="text-xs font-mono break-all line-clamp-2 text-muted-foreground">
                                              {snippet.content}
                                            </code>
                                          </div>

                                          <div className="flex items-center gap-2">
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="default"
                                                  className="flex-1"
                                                  onClick={() =>
                                                    handleExecute(snippet)
                                                  }
                                                >
                                                  <Play className="w-3 h-3 mr-1" />
                                                  {t("snippets.run")}
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>
                                                  {t("snippets.runTooltip")}
                                                </p>
                                              </TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() =>
                                                    handleCopy(snippet)
                                                  }
                                                >
                                                  <Copy className="w-3 h-3" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>
                                                  {t("snippets.copyTooltip")}
                                                </p>
                                              </TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() =>
                                                    handleEdit(snippet)
                                                  }
                                                >
                                                  <Edit className="w-3 h-3" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>
                                                  {t("snippets.editTooltip")}
                                                </p>
                                              </TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() =>
                                                    handleDelete(snippet)
                                                  }
                                                  className="hover:bg-destructive hover:text-destructive-foreground"
                                                >
                                                  <Trash2 className="w-3 h-3" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>
                                                  {t("snippets.deleteTooltip")}
                                                </p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            },
                          )}
                        </div>
                      </TooltipProvider>
                    )}
                  </TabsContent>

                  <TabsContent
                    value="command-history"
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="space-y-2 flex-shrink-0 mb-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t("commandHistory.searchPlaceholder", {
                            defaultValue: "Search commands...",
                          })}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                          }}
                          className="pl-10 pr-10"
                        />
                        {searchQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                            onClick={() => setSearchQuery("")}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground bg-muted/30 px-2 py-1.5 rounded">
                        {t("commandHistory.tabHint", {
                          defaultValue:
                            "Use Tab in Terminal to autocomplete from command history",
                        })}
                      </p>
                    </div>

                    <div className="flex-1 overflow-hidden min-h-0">
                      {historyError ? (
                        <div className="text-center py-8">
                          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-4">
                            <p className="text-destructive font-medium mb-2">
                              {t("commandHistory.error", {
                                defaultValue: "Error loading history",
                              })}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {historyError}
                            </p>
                          </div>
                          <Button
                            onClick={() =>
                              setHistoryRefreshCounter((prev) => prev + 1)
                            }
                            variant="outline"
                          >
                            {t("common.retry", { defaultValue: "Retry" })}
                          </Button>
                        </div>
                      ) : !activeTerminal ? (
                        <div className="text-center text-muted-foreground py-8">
                          <Terminal className="h-12 w-12 mb-4 opacity-20 mx-auto" />
                          <p className="mb-2 font-medium">
                            {t("commandHistory.noTerminal", {
                              defaultValue: "No active terminal",
                            })}
                          </p>
                          <p className="text-sm">
                            {t("commandHistory.noTerminalHint", {
                              defaultValue:
                                "Open a terminal to see its command history.",
                            })}
                          </p>
                        </div>
                      ) : isHistoryLoading && commandHistory.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          <Loader2 className="h-12 w-12 mb-4 opacity-20 mx-auto animate-spin" />
                          <p className="mb-2 font-medium">
                            {t("commandHistory.loading", {
                              defaultValue: "Loading command history...",
                            })}
                          </p>
                        </div>
                      ) : filteredCommands.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          {searchQuery ? (
                            <>
                              <Search className="h-12 w-12 mb-2 opacity-20 mx-auto" />
                              <p className="mb-2 font-medium">
                                {t("commandHistory.noResults", {
                                  defaultValue: "No commands found",
                                })}
                              </p>
                              <p className="text-sm">
                                {t("commandHistory.noResultsHint", {
                                  defaultValue: `No commands matching "${searchQuery}"`,
                                  query: searchQuery,
                                })}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="mb-2 font-medium">
                                {t("commandHistory.empty", {
                                  defaultValue: "No command history yet",
                                })}
                              </p>
                              <p className="text-sm">
                                {t("commandHistory.emptyHint", {
                                  defaultValue:
                                    "Execute commands in the active terminal to build its history.",
                                })}
                              </p>
                            </>
                          )}
                        </div>
                      ) : (
                        <div
                          ref={commandHistoryScrollRef}
                          className="space-y-2 overflow-y-auto h-full"
                        >
                          {filteredCommands.map((command, index) => (
                            <div
                              key={index}
                              className="bg-dark-bg border-2 border-dark-border rounded-md px-3 py-2.5 hover:bg-dark-hover-alt hover:border-gray-600 transition-all duration-200 group h-12 flex items-center"
                            >
                              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                                <span
                                  className="flex-1 font-mono text-sm cursor-pointer text-white truncate"
                                  onClick={() => handleCommandSelect(command)}
                                  title={command}
                                >
                                  {command}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCommandDelete(command);
                                  }}
                                  title={t("commandHistory.deleteTooltip", {
                                    defaultValue: "Delete command",
                                  })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="split-screen"
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className="space-y-4 flex-1 overflow-y-auto overflow-x-hidden pb-4">
                      <Tabs
                        value={splitMode}
                        onValueChange={(value) =>
                          handleSplitModeChange(
                            value as "none" | "2" | "3" | "4",
                          )
                        }
                        className="w-full"
                      >
                        <TabsList className="w-full grid grid-cols-4">
                          <TabsTrigger value="none">
                            {t("splitScreen.none", { defaultValue: "None" })}
                          </TabsTrigger>
                          <TabsTrigger value="2">
                            {t("splitScreen.twoSplit", {
                              defaultValue: "2-Split",
                            })}
                          </TabsTrigger>
                          <TabsTrigger value="3">
                            {t("splitScreen.threeSplit", {
                              defaultValue: "3-Split",
                            })}
                          </TabsTrigger>
                          <TabsTrigger value="4">
                            {t("splitScreen.fourSplit", {
                              defaultValue: "4-Split",
                            })}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>

                      {splitMode !== "none" && (
                        <>
                          <Separator />

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-white">
                              {t("splitScreen.availableTabs", {
                                defaultValue: "Available Tabs",
                              })}
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                              {t("splitScreen.dragTabsHint", {
                                defaultValue:
                                  "Drag tabs into the grid below to position them",
                              })}
                            </p>
                            <div className="space-y-1 max-h-[200px] overflow-y-auto">
                              {splittableTabs.map((tab) => {
                                const isAssigned = Array.from(
                                  splitAssignments.values(),
                                ).includes(tab.id);
                                const isDragging = draggedTabId === tab.id;

                                return (
                                  <div
                                    key={tab.id}
                                    draggable={!isAssigned}
                                    onDragStart={() =>
                                      handleTabDragStart(tab.id)
                                    }
                                    onDragEnd={handleTabDragEnd}
                                    className={`
                                      px-3 py-2 rounded-md text-sm cursor-move transition-all
                                      ${
                                        isAssigned
                                          ? "bg-dark-bg/50 text-muted-foreground cursor-not-allowed opacity-50"
                                          : "bg-dark-bg border border-dark-border hover:border-gray-400 hover:bg-dark-bg-input"
                                      }
                                      ${isDragging ? "opacity-50" : ""}
                                    `}
                                  >
                                    <span className="truncate">
                                      {tab.title}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <Separator />

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-white">
                              {t("splitScreen.layout", {
                                defaultValue: "Layout",
                              })}
                            </label>
                            <div
                              className={`grid gap-2 ${
                                splitMode === "2"
                                  ? "grid-cols-2"
                                  : splitMode === "3"
                                    ? "grid-cols-2 grid-rows-2"
                                    : "grid-cols-2 grid-rows-2"
                              }`}
                            >
                              {Array.from(
                                { length: parseInt(splitMode) },
                                (_, idx) => {
                                  const assignedTabId =
                                    splitAssignments.get(idx);
                                  const assignedTab = assignedTabId
                                    ? tabs.find((t) => t.id === assignedTabId)
                                    : null;
                                  const isHovered = dragOverCellIndex === idx;
                                  const isEmpty = !assignedTabId;

                                  return (
                                    <div
                                      key={idx}
                                      onDragOver={(e) =>
                                        handleTabDragOver(e, idx)
                                      }
                                      onDragLeave={handleTabDragLeave}
                                      onDrop={() => handleTabDrop(idx)}
                                      className={`
                                        relative bg-dark-bg border-2 rounded-md p-3 min-h-[100px]
                                        flex flex-col items-center justify-center transition-all
                                        ${splitMode === "3" && idx === 2 ? "col-span-2" : ""}
                                        ${
                                          isEmpty
                                            ? "border-dashed border-dark-border"
                                            : "border-solid border-gray-400 bg-gray-500/10"
                                        }
                                        ${
                                          isHovered && draggedTabId
                                            ? "border-gray-500 bg-gray-500/20 ring-2 ring-gray-500/50"
                                            : ""
                                        }
                                      `}
                                    >
                                      {assignedTab ? (
                                        <>
                                          <span className="text-sm text-white truncate w-full text-center mb-2">
                                            {assignedTab.title}
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                              handleRemoveFromCell(idx)
                                            }
                                            className="h-6 text-xs hover:bg-red-500/20"
                                          >
                                            Remove
                                          </Button>
                                        </>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">
                                          {t("splitScreen.dropHere", {
                                            defaultValue: "Drop tab here",
                                          })}
                                        </span>
                                      )}
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2 pt-2">
                            <Button
                              onClick={handleApplySplit}
                              className="flex-1"
                              disabled={splitAssignments.size === 0}
                            >
                              {t("splitScreen.apply", {
                                defaultValue: "Apply Split",
                              })}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleClearSplit}
                              className="flex-1"
                            >
                              {t("splitScreen.clear", {
                                defaultValue: "Clear",
                              })}
                            </Button>
                          </div>
                        </>
                      )}

                      {splitMode === "none" && (
                        <div className="text-center py-8">
                          <LayoutGrid className="h-12 w-12 mb-4 opacity-20 mx-auto" />
                          <p className="text-sm text-muted-foreground mb-2">
                            {t("splitScreen.selectMode", {
                              defaultValue:
                                "Select a split mode to get started",
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("splitScreen.helpText", {
                              defaultValue:
                                "Choose how many tabs you want to display at once",
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </SidebarContent>
              {isOpen && (
                <div
                  className="absolute top-0 h-full cursor-col-resize z-[60]"
                  onMouseDown={handleMouseDown}
                  style={{
                    left: "-8px",
                    width: "18px",
                    backgroundColor: isResizing
                      ? "var(--dark-active)"
                      : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor =
                        "var(--dark-border-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                  title="Drag to resize sidebar"
                />
              )}
            </Sidebar>
          </SidebarProvider>
        </div>
      )}

      {showDialog && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[9999999] bg-black/50 backdrop-blur-sm"
          onClick={() => setShowDialog(false)}
        >
          <div
            className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white">
                {editingSnippet ? t("snippets.edit") : t("snippets.create")}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {editingSnippet
                  ? t("snippets.editDescription")
                  : t("snippets.createDescription")}
              </p>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white flex items-center gap-1">
                  {t("snippets.name")}
                  <span className="text-destructive">*</span>
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder={t("snippets.namePlaceholder")}
                  className={`${formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  autoFocus
                />
                {formErrors.name && (
                  <p className="text-xs text-destructive mt-1">
                    {t("snippets.nameRequired")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  {t("snippets.description")}
                  <span className="text-muted-foreground ml-1">
                    ({t("common.optional")})
                  </span>
                </label>
                <Input
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder={t("snippets.descriptionPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  {t("snippets.folder", { defaultValue: "Folder" })}
                  <span className="text-muted-foreground">
                    ({t("common.optional")})
                  </span>
                </label>
                <Select
                  value={formData.folder || "__no_folder__"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      folder: value === "__no_folder__" ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("snippets.selectFolder", {
                        defaultValue: "Select a folder or leave empty",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__no_folder__">
                      {t("snippets.noFolder", {
                        defaultValue: "No folder (Uncategorized)",
                      })}
                    </SelectItem>
                    {snippetFolders.map((folder) => {
                      const FolderIcon = getFolderIcon(folder.name);
                      return (
                        <SelectItem key={folder.id} value={folder.name}>
                          <div className="flex items-center gap-2">
                            <FolderIcon
                              className="h-4 w-4"
                              style={{
                                color: folder.color || undefined,
                              }}
                            />
                            <span>{folder.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white flex items-center gap-1">
                  {t("snippets.content")}
                  <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={formData.content}
                  onChange={(e) =>
                    setFormData({ ...formData, content: e.target.value })
                  }
                  placeholder={t("snippets.contentPlaceholder")}
                  className={`font-mono text-sm ${formErrors.content ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  rows={10}
                />
                {formErrors.content && (
                  <p className="text-xs text-destructive mt-1">
                    {t("snippets.contentRequired")}
                  </p>
                )}
              </div>
            </div>

            <Separator className="my-6" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDialog(false)}
                className="flex-1"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSubmit} className="flex-1">
                {editingSnippet ? t("snippets.edit") : t("snippets.create")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showFolderDialog && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[9999999] bg-black/50 backdrop-blur-sm"
          onClick={() => setShowFolderDialog(false)}
        >
          <div
            className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white">
                {editingFolder
                  ? t("snippets.editFolder", { defaultValue: "Edit Folder" })
                  : t("snippets.createFolder", {
                      defaultValue: "Create Folder",
                    })}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {editingFolder
                  ? t("snippets.editFolderDescription", {
                      defaultValue: "Customize your snippet folder",
                    })
                  : t("snippets.createFolderDescription", {
                      defaultValue: "Organize your snippets into folders",
                    })}
              </p>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white flex items-center gap-1">
                  {t("snippets.folderName", { defaultValue: "Folder Name" })}
                  <span className="text-destructive">*</span>
                </label>
                <Input
                  value={folderFormData.name}
                  onChange={(e) =>
                    setFolderFormData({
                      ...folderFormData,
                      name: e.target.value,
                    })
                  }
                  placeholder={t("snippets.folderNamePlaceholder", {
                    defaultValue: "e.g., System Commands, Docker Scripts",
                  })}
                  className={`${folderFormErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  autoFocus
                />
                {folderFormErrors.name && (
                  <p className="text-xs text-destructive mt-1">
                    {t("snippets.folderNameRequired", {
                      defaultValue: "Folder name is required",
                    })}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold text-white">
                  {t("snippets.folderColor", { defaultValue: "Folder Color" })}
                </Label>
                <div className="grid grid-cols-4 gap-3">
                  {AVAILABLE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`h-12 rounded-md border-2 transition-all hover:scale-105 ${
                        folderFormData.color === color.value
                          ? "border-white shadow-lg scale-105"
                          : "border-dark-border"
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() =>
                        setFolderFormData({
                          ...folderFormData,
                          color: color.value,
                        })
                      }
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold text-white">
                  {t("snippets.folderIcon", { defaultValue: "Folder Icon" })}
                </Label>
                <div className="grid grid-cols-5 gap-3">
                  {AVAILABLE_ICONS.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`h-14 rounded-md border-2 transition-all hover:scale-105 flex items-center justify-center ${
                        folderFormData.icon === value
                          ? "border-primary bg-primary/10"
                          : "border-dark-border bg-dark-bg-darker"
                      }`}
                      onClick={() =>
                        setFolderFormData({ ...folderFormData, icon: value })
                      }
                      title={label}
                    >
                      <Icon className="w-6 h-6" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold text-white">
                  {t("snippets.preview", { defaultValue: "Preview" })}
                </Label>
                <div className="flex items-center gap-3 p-4 rounded-md bg-dark-bg-darker border border-dark-border">
                  {(() => {
                    const IconComponent =
                      AVAILABLE_ICONS.find(
                        (i) => i.value === folderFormData.icon,
                      )?.Icon || Folder;
                    return (
                      <IconComponent
                        className="w-5 h-5"
                        style={{ color: folderFormData.color }}
                      />
                    );
                  })()}
                  <span className="font-medium">
                    {folderFormData.name ||
                      t("snippets.folderName", { defaultValue: "Folder Name" })}
                  </span>
                </div>
              </div>
            </div>

            <Separator className="my-6" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowFolderDialog(false)}
                className="flex-1"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleFolderSubmit} className="flex-1">
                {editingFolder
                  ? t("snippets.updateFolder", {
                      defaultValue: "Update Folder",
                    })
                  : t("snippets.createFolder", {
                      defaultValue: "Create Folder",
                    })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
