import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Play, Edit, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
} from "@/ui/main-axios";
import type { Snippet, SnippetData } from "../../../../types/index.js";

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

  useEffect(() => {
    if (isOpen) {
      fetchSnippets();
    }
  }, [isOpen]);

  const fetchSnippets = async () => {
    try {
      setLoading(true);
      const data = await getSnippets();
      // Defensive: ensure data is an array
      setSnippets(Array.isArray(data) ? data : []);
    } catch (err) {
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
        } catch (err) {
          toast.error(t("snippets.deleteFailed"));
        }
      },
      "destructive",
    );
  };

  const handleSubmit = async () => {
    // Validate required fields
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
    } catch (err) {
      toast.error(
        editingSnippet ? t("snippets.updateFailed") : t("snippets.createFailed"),
      );
    }
  };

  const handleExecute = (snippet: Snippet) => {
    onExecute(snippet.content);
    toast.success(t("snippets.executeSuccess", { name: snippet.name }));
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Sidebar - absolutely positioned, doesn't affect terminal layout */}
      <div className="absolute top-0 right-0 h-full w-80 border-l border-border bg-background flex flex-col shadow-lg z-20">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("snippets.title")}</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCreate}>
              <Plus className="w-4 h-4 mr-1" />
              {t("snippets.new")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Snippets List */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : snippets.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <p className="mb-2">{t("snippets.empty")}</p>
              <p className="text-sm">{t("snippets.emptyHint")}</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {snippets.map((snippet) => (
                <Card key={snippet.id} className="hover:bg-accent/50 transition">
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-sm font-medium">
                      {snippet.name}
                    </CardTitle>
                    {snippet.description && (
                      <CardDescription className="text-xs">
                        {snippet.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <div className="bg-muted rounded p-2 mb-2">
                      <code className="text-xs font-mono break-all line-clamp-3">
                        {snippet.content}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        onClick={() => handleExecute(snippet)}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        {t("snippets.run")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(snippet)}
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(snippet)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Create/Edit Dialog - centered modal */}
      {showDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
          <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-white">
                {editingSnippet ? t("snippets.edit") : t("snippets.create")}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {editingSnippet
                  ? t("snippets.editDescription")
                  : t("snippets.createDescription")}
              </p>
            </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {t("snippets.name")} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t("snippets.namePlaceholder")}
                className={formErrors.name ? "border-destructive" : ""}
              />
              {formErrors.name && (
                <p className="text-xs text-destructive mt-1">
                  {t("snippets.nameRequired")}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">
                {t("snippets.description")}
              </label>
              <Input
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t("snippets.descriptionPlaceholder")}
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {t("snippets.content")} <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder={t("snippets.contentPlaceholder")}
                className={`font-mono ${formErrors.content ? "border-destructive" : ""}`}
                rows={8}
              />
              {formErrors.content && (
                <p className="text-xs text-destructive mt-1">
                  {t("snippets.contentRequired")}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSubmit} className="flex-1">
              {editingSnippet ? t("common.update") : t("common.create")}
            </Button>
          </div>
          </div>
        </div>
      )}
    </>
  );
}
