import React, { useRef, useState, useEffect } from "react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { Control, UseFormWatch } from "react-hook-form";

interface CredentialGeneralTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  folders: string[];
  t: (key: string, params?: any) => string;
}

export function CredentialGeneralTab({
  control,
  watch,
  folders,
  t,
}: CredentialGeneralTabProps) {
  const [tagInput, setTagInput] = useState("");
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);

  const folderValue = watch("folder");
  const filteredFolders = React.useMemo(() => {
    if (!folderValue) return folders;
    return folders.filter((f) =>
      f.toLowerCase().includes(folderValue.toLowerCase()),
    );
  }, [folderValue, folders]);

  const handleFolderClick = (
    folder: string,
    onChange: (value: string) => void,
  ) => {
    onChange(folder);
    setFolderDropdownOpen(false);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        folderDropdownRef.current &&
        !folderDropdownRef.current.contains(event.target as Node) &&
        folderInputRef.current &&
        !folderInputRef.current.contains(event.target as Node)
      ) {
        setFolderDropdownOpen(false);
      }
    }

    if (folderDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [folderDropdownOpen]);

  return (
    <>
      <FormLabel className="mb-2 font-bold">
        {t("credentials.basicInformation")}
      </FormLabel>
      <div className="grid grid-cols-12 gap-3">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem className="col-span-6">
              <FormLabel>{t("credentials.credentialName")}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t("placeholders.credentialName")}
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="username"
          render={({ field }) => (
            <FormItem className="col-span-6">
              <FormLabel>{t("credentials.username")}</FormLabel>
              <FormControl>
                <Input placeholder={t("placeholders.username")} {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <FormLabel className="mb-2 mt-4 font-bold">
        {t("credentials.organization")}
      </FormLabel>
      <div className="grid grid-cols-26 gap-3">
        <FormField
          control={control}
          name="description"
          render={({ field }) => (
            <FormItem className="col-span-10">
              <FormLabel>{t("credentials.description")}</FormLabel>
              <FormControl>
                <Input placeholder={t("placeholders.description")} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="folder"
          render={({ field }) => (
            <FormItem className="col-span-10 relative">
              <FormLabel>{t("credentials.folder")}</FormLabel>
              <FormControl>
                <Input
                  ref={folderInputRef}
                  placeholder={t("placeholders.folder")}
                  className="min-h-[40px]"
                  autoComplete="off"
                  value={field.value}
                  onFocus={() => setFolderDropdownOpen(true)}
                  onChange={(e) => {
                    field.onChange(e);
                    setFolderDropdownOpen(true);
                  }}
                />
              </FormControl>
              {folderDropdownOpen && filteredFolders.length > 0 && (
                <div
                  ref={folderDropdownRef}
                  className="absolute top-full left-0 z-50 mt-1 w-full bg-canvas border border-input rounded-md shadow-lg max-h-40 overflow-y-auto thin-scrollbar p-1"
                >
                  <div className="grid grid-cols-1 gap-1 p-0">
                    {filteredFolders.map((folder) => (
                      <Button
                        key={folder}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-left rounded px-2 py-1.5 hover:bg-white/15 focus:bg-white/20 focus:outline-none"
                        onClick={() =>
                          handleFolderClick(folder, field.onChange)
                        }
                      >
                        {folder}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="tags"
          render={({ field }) => (
            <FormItem className="col-span-10 overflow-visible">
              <FormLabel>{t("credentials.tags")}</FormLabel>
              <FormControl>
                <div className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-field focus-within:ring-2 ring-ring min-h-[40px]">
                  {(field.value || []).map((tag: string, idx: number) => (
                    <span
                      key={`${tag}-${idx}`}
                      className="flex items-center bg-surface text-foreground rounded-full px-2 py-0.5 text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-1 text-foreground-subtle hover:text-red-500 focus:outline-none"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const newTags = (field.value || []).filter(
                            (_: string, i: number) => i !== idx,
                          );
                          field.onChange(newTags);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="flex-1 min-w-[60px] border-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground p-0 h-6 text-sm"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === " " && tagInput.trim() !== "") {
                        e.preventDefault();
                        const currentTags = field.value || [];
                        if (!currentTags.includes(tagInput.trim())) {
                          field.onChange([...currentTags, tagInput.trim()]);
                        }
                        setTagInput("");
                      } else if (e.key === "Enter" && tagInput.trim() !== "") {
                        e.preventDefault();
                        const currentTags = field.value || [];
                        if (!currentTags.includes(tagInput.trim())) {
                          field.onChange([...currentTags, tagInput.trim()]);
                        }
                        setTagInput("");
                      } else if (
                        e.key === "Backspace" &&
                        tagInput === "" &&
                        (field.value || []).length > 0
                      ) {
                        const currentTags = field.value || [];
                        field.onChange(currentTags.slice(0, -1));
                      }
                    }}
                    placeholder={t("credentials.addTagsSpaceToAdd")}
                  />
                </div>
              </FormControl>
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
