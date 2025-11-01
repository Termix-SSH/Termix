import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Play, Edit, Trash2, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
} from "@/ui/main-axios";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import type { Snippet, SnippetData } from "../../../../types/index.js";

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

interface SnippetsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (content: string) => void;
}

export function SnippetsSidebar({
  isOpen,
  onClose,
  onExecute,
}: SnippetsSidebarProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const { tabs } = useTabs() as { tabs: TabData[] };
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
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchSnippets();
    }
  }, [isOpen]);

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

  const handleTabToggle = (tabId: number) => {
    setSelectedTabIds((prev) =>
      prev.includes(tabId)
        ? prev.filter((id) => id !== tabId)
        : [...prev, tabId],
    );
  };

  const handleExecute = (snippet: Snippet) => {
    if (selectedTabIds.length > 0) {
      selectedTabIds.forEach((tabId) => {
        const tab = tabs.find((t: TabData) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(snippet.content + "\n");
        }
      });
      toast.success(
        t("snippets.executeSuccess", {
          name: snippet.name,
          count: selectedTabIds.length,
        }),
      );
    } else {
      onExecute(snippet.content);
      toast.success(t("snippets.executeSuccess", { name: snippet.name }));
    }
  };

  const handleCopy = (snippet: Snippet) => {
    navigator.clipboard.writeText(snippet.content);
    toast.success(t("snippets.copySuccess", { name: snippet.name }));
  };

  const terminalTabs = tabs.filter((tab: TabData) => tab.type === "terminal");

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 bottom-0 z-[999999] flex justify-end pointer-events-auto isolate"
        style={{
          transform: "translateZ(0)",
        }}
      >
        <div className="flex-1 cursor-pointer" onClick={onClose} />

        <div
          className="w-[400px] h-full bg-dark-bg border-l-2 border-dark-border flex flex-col shadow-2xl relative isolate z-[999999]"
          style={{
            boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.5)",
            transform: "translateZ(0)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-dark-border">
            <h2 className="text-lg font-semibold text-white">
              {t("snippets.title")}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
              title={t("common.close")}
            >
              <X />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {terminalTabs.length > 0 && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">
                      {t("snippets.selectTerminals", {
                        defaultValue: "Select Terminals (optional)",
                      })}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {selectedTabIds.length > 0
                        ? t("snippets.executeOnSelected", {
                            defaultValue: `Execute on ${selectedTabIds.length} selected terminal(s)`,
                            count: selectedTabIds.length,
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
                  <Separator className="my-4" />
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
                  <p className="mb-2 font-medium">{t("snippets.empty")}</p>
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
            </div>
          </div>
        </div>
      </div>

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
