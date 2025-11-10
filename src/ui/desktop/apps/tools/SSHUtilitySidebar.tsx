import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
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
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import type { Snippet, SnippetData } from "../../../../types";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: {
    current?: {
      sendInput?: (data: string) => void;
    };
  };
  [key: string]: unknown;
}

interface SSHUtilitySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSnippetExecute: (content: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  commandHistory?: string[];
  onSelectCommand?: (command: string) => void;
  onDeleteCommand?: (command: string) => void;
  isHistoryLoading?: boolean;
  initialTab?: string;
  onTabChange?: () => void;
}

export function SSHUtilitySidebar({
  isOpen,
  onClose,
  onSnippetExecute,
  sidebarWidth,
  setSidebarWidth,
  commandHistory = [],
  onSelectCommand,
  onDeleteCommand,
  isHistoryLoading = false,
  initialTab,
  onTabChange,
}: SSHUtilitySidebarProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const { tabs } = useTabs() as { tabs: TabData[] };
  const [activeTab, setActiveTab] = useState(initialTab || "ssh-tools");

  // Update active tab when initialTab changes
  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Call onTabChange when active tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (onTabChange) {
      onTabChange();
    }
  };

  // SSH Tools state
  const [isRecording, setIsRecording] = useState(false);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);
  const [rightClickCopyPaste, setRightClickCopyPaste] = useState<boolean>(
    () => getCookie("rightClickCopyPaste") === "true",
  );

  // Snippets state
  const [snippets, setSnippets] = useState<Snippet[]>([]);
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

  // Command History state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = React.useRef<number | null>(null);
  const startWidthRef = React.useRef<number>(sidebarWidth);

  const terminalTabs = tabs.filter((tab: TabData) => tab.type === "terminal");

  // Filter command history based on search query
  const filteredCommands = searchQuery
    ? commandHistory.filter((cmd) =>
        cmd.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : commandHistory;

  // Initialize CSS variable on mount and when sidebar width changes
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--right-sidebar-width",
      `${sidebarWidth}px`,
    );
  }, [sidebarWidth]);

  useEffect(() => {
    if (isOpen && activeTab === "snippets") {
      fetchSnippets();
    }
  }, [isOpen, activeTab]);

  // Resize handlers
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
      const dx = startXRef.current - e.clientX; // Reversed because we're on the right
      const newWidth = Math.round(startWidthRef.current + dx);
      const minWidth = 300;
      const maxWidth = Math.round(window.innerWidth * 0.5);

      let finalWidth = newWidth;
      if (newWidth < minWidth) {
        finalWidth = minWidth;
      } else if (newWidth > maxWidth) {
        finalWidth = maxWidth;
      }

      // Update CSS variable immediately for smooth animation
      document.documentElement.style.setProperty(
        "--right-sidebar-width",
        `${finalWidth}px`,
      );

      // Update React state (this will be batched/debounced naturally)
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

  // SSH Tools handlers
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

  // Snippets handlers
  const fetchSnippets = async () => {
    try {
      setLoading(true);
      const data = await getSnippets();
      setSnippets(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t("snippets.failedToFetch"));
      setSnippets([]);
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
  };

  const handleCopy = (snippet: Snippet) => {
    navigator.clipboard.writeText(snippet.content);
    toast.success(t("snippets.copySuccess", { name: snippet.name }));
  };

  // Command History handlers
  const handleCommandSelect = (command: string) => {
    if (onSelectCommand) {
      onSelectCommand(command);
    }
  };

  const handleCommandDelete = (command: string) => {
    if (onDeleteCommand) {
      confirmWithToast(
        t("commandHistory.deleteConfirmDescription", {
          defaultValue: `Delete "${command}" from history?`,
          command,
        }),
        () => {
          onDeleteCommand(command);
          toast.success(
            t("commandHistory.deleteSuccess", {
              defaultValue: "Command deleted from history",
            }),
          );
        },
        "destructive",
      );
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
              <SidebarContent className="p-4">
                <Tabs value={activeTab} onValueChange={handleTabChange}>
                  <TabsList className="w-full grid grid-cols-3 mb-4">
                    <TabsTrigger value="ssh-tools">
                      {t("sshTools.title")}
                    </TabsTrigger>
                    <TabsTrigger value="snippets">
                      {t("snippets.title")}
                    </TabsTrigger>
                    <TabsTrigger value="command-history">
                      {t("commandHistory.title", { defaultValue: "History" })}
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

                    <Separator />

                    <p className="text-sm text-gray-500">
                      {t("sshTools.shareIdeas")}{" "}
                      <a
                        href="https://github.com/Termix-SSH/Termix/issues/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        GitHub
                      </a>
                      !
                    </p>
                  </TabsContent>

                  <TabsContent value="snippets" className="space-y-4">
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

                    <Button
                      onClick={handleCreate}
                      className="w-full"
                      variant="outline"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t("snippets.new")}
                    </Button>

                    {loading ? (
                      <div className="text-center text-muted-foreground py-8">
                        <p>{t("common.loading")}</p>
                      </div>
                    ) : snippets.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        <p className="mb-2 font-medium">
                          {t("snippets.empty")}
                        </p>
                        <p className="text-sm">{t("snippets.emptyHint")}</p>
                      </div>
                    ) : (
                      <TooltipProvider>
                        <div className="space-y-3">
                          {snippets.map((snippet) => (
                            <div
                              key={snippet.id}
                              className="bg-dark-bg-input border border-input rounded-lg cursor-pointer hover:shadow-lg hover:border-blue-400/50 hover:bg-dark-hover-alt transition-all duration-200 p-3 group"
                            >
                              <div className="mb-2">
                                <h3 className="text-sm font-medium text-white mb-1">
                                  {snippet.name}
                                </h3>
                                {snippet.description && (
                                  <p className="text-xs text-muted-foreground">
                                    {snippet.description}
                                  </p>
                                )}
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
                                      onClick={() => handleExecute(snippet)}
                                    >
                                      <Play className="w-3 h-3 mr-1" />
                                      {t("snippets.run")}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{t("snippets.runTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCopy(snippet)}
                                    >
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{t("snippets.copyTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleEdit(snippet)}
                                    >
                                      <Edit className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{t("snippets.editTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleDelete(snippet)}
                                      className="hover:bg-destructive hover:text-destructive-foreground"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{t("snippets.deleteTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TooltipProvider>
                    )}
                  </TabsContent>

                  <TabsContent value="command-history" className="space-y-4">
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t("commandHistory.searchPlaceholder", {
                            defaultValue: "Search commands...",
                          })}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setSelectedCommandIndex(0);
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
                    </div>

                    <div className="flex-1 overflow-hidden">
                      {isHistoryLoading ? (
                        <div className="flex flex-row items-center text-muted-foreground text-sm animate-pulse py-8">
                          <Loader2 className="animate-spin mr-2" size={16} />
                          <span>
                            {t("commandHistory.loading", {
                              defaultValue: "Loading history...",
                            })}
                          </span>
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
                                    "Execute commands to build your history",
                                })}
                              </p>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)]">
                          {filteredCommands.map((command, index) => (
                            <div
                              key={index}
                              className="bg-dark-bg border-2 border-dark-border rounded-md px-3 py-2.5 hover:bg-dark-hover-alt hover:border-blue-400/50 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="flex-1 font-mono text-sm cursor-pointer text-white"
                                  onClick={() => handleCommandSelect(command)}
                                >
                                  {command}
                                </span>
                                {onDeleteCommand && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400"
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
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="text-xs text-muted-foreground">
                      <span>
                        {filteredCommands.length}{" "}
                        {t("commandHistory.commandCount", {
                          defaultValue:
                            filteredCommands.length !== 1
                              ? "commands"
                              : "command",
                        })}
                      </span>
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
    </>
  );
}
