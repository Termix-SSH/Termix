import React, { useRef, useState, useEffect } from "react";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Plus, X } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { JumpHostItem } from "./shared/JumpHostItem.tsx";
import { HostAuthenticationSection } from "./HostAuthenticationSection.tsx";
import type { HostGeneralTabProps } from "./shared/tab-types";

export function HostGeneralTab({
  control,
  watch,
  setValue,
  getValues,
  hosts,
  credentials,
  folders,
  snippets,
  editorTheme,
  editingHost,
  authTab,
  setAuthTab,
  keyInputMethod,
  setKeyInputMethod,
  proxyMode,
  setProxyMode,
  ipInputRef,
  t,
}: HostGeneralTabProps) {
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

  const handleFolderClick = (folder: string) => {
    setValue("folder", folder);
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
      <FormLabel className="mb-3 font-bold">
        {t("hosts.connectionDetails")}
      </FormLabel>
      <div className="grid grid-cols-12 gap-4">
        <FormField
          control={control}
          name="ip"
          render={({ field }) => (
            <FormItem className="col-span-5">
              <FormLabel>{t("hosts.ipAddress")}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t("placeholders.ipAddress")}
                  {...field}
                  ref={(e) => {
                    field.ref(e);
                    if (ipInputRef?.current) {
                      ipInputRef.current = e;
                    }
                  }}
                  onBlur={(e) => {
                    field.onChange(e.target.value.trim());
                    field.onBlur();
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="port"
          render={({ field }) => (
            <FormItem className="col-span-1">
              <FormLabel>{t("hosts.port")}</FormLabel>
              <FormControl>
                <Input placeholder={t("placeholders.port")} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="username"
          render={({ field }) => {
            const isCredentialAuth = authTab === "credential";
            const hasCredential = !!watch("credentialId");
            const overrideEnabled = !!watch("overrideCredentialUsername");
            const shouldDisable =
              isCredentialAuth && hasCredential && !overrideEnabled;

            return (
              <FormItem className="col-span-6">
                <FormLabel>{t("hosts.username")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("placeholders.username")}
                    disabled={shouldDisable}
                    {...field}
                    onBlur={(e) => {
                      field.onChange(e.target.value.trim());
                      field.onBlur();
                    }}
                  />
                </FormControl>
              </FormItem>
            );
          }}
        />
      </div>
      <FormLabel className="mb-3 mt-3 font-bold">
        {t("hosts.organization")}
      </FormLabel>
      <div className="grid grid-cols-26 gap-4">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem className="col-span-10">
              <FormLabel>{t("hosts.name")}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t("placeholders.hostname")}
                  {...field}
                  onBlur={(e) => {
                    field.onChange(e.target.value.trim());
                    field.onBlur();
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="folder"
          render={({ field }) => (
            <FormItem className="col-span-10 relative">
              <FormLabel>{t("hosts.folder")}</FormLabel>
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
                  onBlur={(e) => {
                    field.onChange(e.target.value.trim());
                    field.onBlur();
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
                        onClick={() => handleFolderClick(folder)}
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
              <FormLabel>{t("hosts.tags")}</FormLabel>
              <FormControl>
                <div className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-field focus-within:ring-2 ring-ring min-h-[40px]">
                  {field.value.map((tag: string, idx: number) => (
                    <span
                      key={tag + idx}
                      className="flex items-center bg-gray-200 text-gray-800 rounded-full px-2 py-0.5 text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-1 text-gray-500 hover:text-red-500 focus:outline-none"
                        onClick={() => {
                          const newTags = field.value.filter(
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
                    className="flex-1 min-w-[60px] border-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground p-0 h-6"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === " " && tagInput.trim() !== "") {
                        e.preventDefault();
                        if (!field.value.includes(tagInput.trim())) {
                          field.onChange([...field.value, tagInput.trim()]);
                        }
                        setTagInput("");
                      } else if (
                        e.key === "Backspace" &&
                        tagInput === "" &&
                        field.value.length > 0
                      ) {
                        field.onChange(field.value.slice(0, -1));
                      }
                    }}
                    placeholder={t("hosts.addTagsSpaceToAdd")}
                  />
                </div>
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="pin"
          render={({ field }) => (
            <FormItem className="col-span-6">
              <FormLabel>{t("hosts.pin")}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="notes"
          render={({ field }) => (
            <FormItem className="col-span-26">
              <FormLabel>{t("hosts.notes")}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("placeholders.notes")}
                  className="resize-none"
                  rows={3}
                  value={field.value || ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <FormLabel className="mb-3 mt-3 font-bold">
        {t("hosts.authentication")}
      </FormLabel>
      <HostAuthenticationSection
        control={control}
        watch={watch}
        setValue={setValue}
        credentials={credentials}
        authTab={authTab}
        setAuthTab={setAuthTab}
        keyInputMethod={keyInputMethod}
        setKeyInputMethod={setKeyInputMethod}
        editorTheme={editorTheme}
        editingHost={editingHost}
        t={t}
      />
      <Separator className="my-6" />
      <Accordion type="multiple" className="w-full">
        <AccordionItem value="advanced-auth">
          <AccordionTrigger>{t("hosts.advancedAuthSettings")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <FormField
              control={control}
              name="forceKeyboardInteractive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.forceKeyboardInteractive")}</FormLabel>
                    <FormDescription>
                      {t("hosts.forceKeyboardInteractiveDesc")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="jump-hosts">
          <AccordionTrigger>{t("hosts.jumpHosts")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <Alert>
              <AlertDescription>
                {t("hosts.jumpHostsDescription")}
              </AlertDescription>
            </Alert>
            <FormField
              control={control}
              name="jumpHosts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("hosts.jumpHostChain")}</FormLabel>
                  <FormControl>
                    <div className="space-y-3">
                      {field.value.map((jumpHost, index) => (
                        <JumpHostItem
                          key={index}
                          jumpHost={jumpHost}
                          index={index}
                          hosts={hosts}
                          editingHost={editingHost}
                          onUpdate={(hostId) => {
                            const newJumpHosts = [...field.value];
                            newJumpHosts[index] = { hostId };
                            field.onChange(newJumpHosts);
                          }}
                          onRemove={() => {
                            const newJumpHosts = field.value.filter(
                              (_, i) => i !== index,
                            );
                            field.onChange(newJumpHosts);
                          }}
                          t={t}
                        />
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          field.onChange([...field.value, { hostId: 0 }]);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {t("hosts.addJumpHost")}
                      </Button>
                    </div>
                  </FormControl>
                  <FormDescription>{t("hosts.jumpHostsOrder")}</FormDescription>
                </FormItem>
              )}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="socks5">
          <AccordionTrigger>{t("hosts.socks5Proxy")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <Alert>
              <AlertDescription>
                {t("hosts.socks5Description")}
              </AlertDescription>
            </Alert>

            <FormField
              control={control}
              name="useSocks5"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>{t("hosts.enableSocks5")}</FormLabel>
                    <FormDescription>
                      {t("hosts.enableSocks5Description")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {watch("useSocks5") && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <FormLabel>{t("hosts.socks5ProxyMode")}</FormLabel>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={proxyMode === "single" ? "default" : "outline"}
                      onClick={() => setProxyMode("single")}
                      className="flex-1"
                    >
                      {t("hosts.socks5UseSingleProxy")}
                    </Button>
                    <Button
                      type="button"
                      variant={proxyMode === "chain" ? "default" : "outline"}
                      onClick={() => setProxyMode("chain")}
                      className="flex-1"
                    >
                      {t("hosts.socks5UseProxyChain")}
                    </Button>
                  </div>
                </div>

                {proxyMode === "single" && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <FormField
                      control={control}
                      name="socks5Host"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("hosts.socks5Host")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("placeholders.socks5Host")}
                              {...field}
                              onBlur={(e) => {
                                field.onChange(e.target.value.trim());
                                field.onBlur();
                              }}
                            />
                          </FormControl>
                          <FormDescription>
                            {t("hosts.socks5HostDescription")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="socks5Port"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("hosts.socks5Port")}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder={t("placeholders.socks5Port")}
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value) || 1080)
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            {t("hosts.socks5PortDescription")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="socks5Username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("hosts.socks5Username")} {t("hosts.optional")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("hosts.username")}
                              {...field}
                              onBlur={(e) => {
                                field.onChange(e.target.value.trim());
                                field.onBlur();
                              }}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="socks5Password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("hosts.socks5Password")} {t("hosts.optional")}
                          </FormLabel>
                          <FormControl>
                            <PasswordInput
                              placeholder={t("hosts.password")}
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {proxyMode === "chain" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <FormLabel>{t("hosts.socks5ProxyChain")}</FormLabel>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const currentChain = watch("socks5ProxyChain") || [];
                          setValue("socks5ProxyChain", [
                            ...currentChain,
                            {
                              host: "",
                              port: 1080,
                              type: 5 as 4 | 5,
                              username: "",
                              password: "",
                            },
                          ]);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {t("hosts.addProxyNode")}
                      </Button>
                    </div>

                    {(watch("socks5ProxyChain") || []).length === 0 && (
                      <div className="text-sm text-muted-foreground text-center p-4 border rounded-lg border-dashed">
                        {t("hosts.noProxyNodes")}
                      </div>
                    )}

                    {(watch("socks5ProxyChain") || []).map(
                      (node: any, index: number) => (
                        <div
                          key={index}
                          className="p-4 border rounded-lg space-y-3 relative"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">
                              {t("hosts.proxyNode")} {index + 1}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const currentChain =
                                  watch("socks5ProxyChain") || [];
                                setValue(
                                  "socks5ProxyChain",
                                  currentChain.filter(
                                    (_: any, i: number) => i !== index,
                                  ),
                                );
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <FormLabel>{t("hosts.socks5Host")}</FormLabel>
                              <Input
                                placeholder={t("placeholders.socks5Host")}
                                value={node.host}
                                onChange={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    host: e.target.value,
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                                onBlur={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    host: e.target.value.trim(),
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <FormLabel>{t("hosts.socks5Port")}</FormLabel>
                              <Input
                                type="number"
                                placeholder={t("placeholders.socks5Port")}
                                value={node.port}
                                onChange={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    port: parseInt(e.target.value) || 1080,
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <FormLabel>{t("hosts.proxyType")}</FormLabel>
                            <Select
                              value={String(node.type)}
                              onValueChange={(value) => {
                                const currentChain =
                                  watch("socks5ProxyChain") || [];
                                const newChain = [...currentChain];
                                newChain[index] = {
                                  ...newChain[index],
                                  type: parseInt(value) as 4 | 5,
                                };
                                setValue("socks5ProxyChain", newChain);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="4">
                                  {t("hosts.socks4")}
                                </SelectItem>
                                <SelectItem value="5">
                                  {t("hosts.socks5")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <FormLabel>
                                {t("hosts.socks5Username")}{" "}
                                {t("hosts.optional")}
                              </FormLabel>
                              <Input
                                placeholder={t("hosts.username")}
                                value={node.username || ""}
                                onChange={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    username: e.target.value,
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                                onBlur={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    username: e.target.value.trim(),
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <FormLabel>
                                {t("hosts.socks5Password")}{" "}
                                {t("hosts.optional")}
                              </FormLabel>
                              <PasswordInput
                                placeholder={t("hosts.password")}
                                value={node.password || ""}
                                onChange={(e) => {
                                  const currentChain =
                                    watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    password: e.target.value,
                                  };
                                  setValue("socks5ProxyChain", newChain);
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
