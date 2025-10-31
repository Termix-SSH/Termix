import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2, Edit, Plus, X } from "lucide-react";
import { sshHostApi } from "@/ui/main-axios.ts";

interface CustomButton {
  id: number;
  label: string;
  command: string;
  icon?: string;
  order: number;
}

interface ManageCustomButtonsProps {
  isOpen: boolean;
  hostId: number;
  onClose: () => void;
  onButtonsUpdated: () => void;
}

export function ManageCustomButtons({
  isOpen,
  hostId,
  onClose,
  onButtonsUpdated,
}: ManageCustomButtonsProps) {
  const { t } = useTranslation();
  const [buttons, setButtons] = React.useState<CustomButton[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [editingButton, setEditingButton] = React.useState<CustomButton | null>(
    null,
  );
  const [isAdding, setIsAdding] = React.useState(false);
  const [formData, setFormData] = React.useState({
    label: "",
    command: "",
    icon: "",
  });

  const fetchButtons = React.useCallback(async () => {
    if (!hostId) return;
    try {
      setIsLoading(true);
      const response = await sshHostApi.get(
        `/db/host/${hostId}/custom-buttons`,
      );
      setButtons(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Failed to fetch custom buttons:", error);
      toast.error(t("serverStats.failedToFetchButtons"));
      setButtons([]);
    } finally {
      setIsLoading(false);
    }
  }, [hostId, t]);

  React.useEffect(() => {
    if (isOpen) {
      fetchButtons();
    }
  }, [isOpen, fetchButtons]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.label.trim() || !formData.command.trim()) {
      toast.error(
        t("serverStats.buttonLabel") +
          " and " +
          t("serverStats.buttonCommand") +
          " are required",
      );
      return;
    }

    try {
      setIsLoading(true);

      if (editingButton) {
        await sshHostApi.put(
          `/db/host/${hostId}/custom-buttons/${editingButton.id}`,
          formData,
        );
        toast.success(t("serverStats.buttonUpdated"));
      } else {
        await sshHostApi.post(`/db/host/${hostId}/custom-buttons`, formData);
        toast.success(t("serverStats.buttonCreated"));
      }

      setFormData({ label: "", command: "", icon: "" });
      setEditingButton(null);
      setIsAdding(false);
      await fetchButtons();
      onButtonsUpdated();
    } catch (error) {
      console.error("Failed to save button:", error);
      toast.error(
        editingButton
          ? t("serverStats.failedToUpdateButton")
          : t("serverStats.failedToCreateButton"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (buttonId: number, label: string) => {
    if (!confirm(t("serverStats.deleteButtonConfirm", { label }))) {
      return;
    }

    try {
      setIsLoading(true);
      await sshHostApi.delete(`/db/host/${hostId}/custom-buttons/${buttonId}`);
      toast.success(t("serverStats.buttonDeleted"));
      await fetchButtons();
      onButtonsUpdated();
    } catch (error) {
      console.error("Failed to delete button:", error);
      toast.error(t("serverStats.failedToDeleteButton"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (button: CustomButton) => {
    setEditingButton(button);
    setFormData({
      label: button.label,
      command: button.command,
      icon: button.icon || "",
    });
    setIsAdding(true);
  };

  const handleCancelEdit = () => {
    setEditingButton(null);
    setFormData({ label: "", command: "", icon: "" });
    setIsAdding(false);
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="bg-dark-bg border border-dark-border rounded-xl shadow-2xl max-w-2xl w-full mx-4 relative z-10 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-dark-border/50 bg-dark-bg/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-100">
              {t("serverStats.manageButtons")}
            </h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 hover:bg-dark-bg-darker"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Button List */}
        {!isAdding && (
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading && (!Array.isArray(buttons) || buttons.length === 0) ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-muted-foreground">
                    {t("common.loading")}
                  </p>
                </div>
              </div>
            ) : !Array.isArray(buttons) || buttons.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-dark-bg-darker flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                </div>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {t("serverStats.noCustomButtonsMessage")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {Array.isArray(buttons) &&
                  buttons.map((button) => (
                    <div
                      key={button.id}
                      className="group flex items-center justify-between p-4 bg-dark-bg-darker border border-dark-border rounded-lg hover:border-primary/30 hover:bg-dark-bg-darker/80 transition-all duration-200"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="font-medium text-gray-200 truncate mb-1">
                          {button.label}
                        </p>
                        <p className="text-sm text-muted-foreground truncate font-mono">
                          {button.command}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(button)}
                          disabled={isLoading}
                          className="h-9 w-9 p-0 hover:bg-primary/10 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(button.id, button.label)}
                          disabled={isLoading}
                          className="h-9 w-9 p-0 text-red-400 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Add/Edit Form */}
        {isAdding ? (
          <div className="p-6 border-t border-dark-border/50 bg-dark-bg/30">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label
                  htmlFor="label"
                  className="text-sm font-medium text-gray-300"
                >
                  {t("serverStats.buttonLabel")}
                </Label>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) =>
                    setFormData({ ...formData, label: e.target.value })
                  }
                  placeholder={t("serverStats.enterButtonLabel")}
                  className="mt-2"
                  autoFocus
                  required
                />
              </div>

              <div>
                <Label
                  htmlFor="command"
                  className="text-sm font-medium text-gray-300"
                >
                  {t("serverStats.buttonCommand")}
                </Label>
                <Input
                  id="command"
                  value={formData.command}
                  onChange={(e) =>
                    setFormData({ ...formData, command: e.target.value })
                  }
                  placeholder={t("serverStats.enterCommand")}
                  className="mt-2 font-mono"
                  required
                />
              </div>

              <div>
                <Label
                  htmlFor="icon"
                  className="text-sm font-medium text-gray-300"
                >
                  {t("serverStats.buttonIcon")}
                </Label>
                <Input
                  id="icon"
                  value={formData.icon}
                  onChange={(e) =>
                    setFormData({ ...formData, icon: e.target.value })
                  }
                  placeholder={t("serverStats.iconOptional")}
                  className="mt-2"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 font-medium"
                >
                  {editingButton
                    ? t("serverStats.editButton")
                    : t("serverStats.addButton")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-6 border-t border-dark-border/50 bg-dark-bg/30">
            <Button
              onClick={() => setIsAdding(true)}
              disabled={isLoading}
              className="w-full font-medium"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("serverStats.addButton")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
