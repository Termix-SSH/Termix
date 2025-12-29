import React from "react";
import { Controller } from "react-hook-form";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { CredentialSelector } from "@/ui/desktop/apps/host-manager/credentials/CredentialSelector.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { Plus, X, Upload, AlertCircle } from "lucide-react";
import type { HostGeneralTabProps } from "./shared/tab-types";
import { JumpHostItem } from "./shared/JumpHostItem";

export function HostGeneralTab({
  form,
  authTab,
  setAuthTab,
  keyInputMethod,
  setKeyInputMethod,
  proxyMode,
  setProxyMode,
  tagInput,
  setTagInput,
  folderDropdownOpen,
  setFolderDropdownOpen,
  folderInputRef,
  folderDropdownRef,
  filteredFolders,
  handleFolderClick,
  keyTypeDropdownOpen,
  setKeyTypeDropdownOpen,
  keyTypeButtonRef,
  keyTypeDropdownRef,
  keyTypeOptions,
  ipInputRef,
  editorTheme,
  hosts,
  editingHost,
  folders,
  credentials,
  t,
}: HostGeneralTabProps) {
  return (
    <div className="pt-2">
      <FormLabel className="mb-3 font-bold">
        {t("hosts.connectionDetails")}
      </FormLabel>
      <div className="grid grid-cols-12 gap-4">
        <FormField
          control={form.control}
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
                    ipInputRef.current = e;
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
          control={form.control}
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
          control={form.control}
          name="username"
          render={({ field }) => {
            const isCredentialAuth = authTab === "credential";
            const hasCredential = !!form.watch("credentialId");
            const overrideEnabled = !!form.watch("overrideCredentialUsername");
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
          control={form.control}
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
          control={form.control}
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
                        className="w-full justify-start text-left rounded px-2 py-1.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
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
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem className="col-span-10 overflow-visible">
              <FormLabel>{t("hosts.tags")}</FormLabel>
              <FormControl>
                <div className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-field focus-within:ring-2 ring-ring min-h-[40px]">
                  {field.value.map((tag: string, idx: number) => (
                    <span
                      key={tag + idx}
                      className="flex items-center bg-surface text-foreground rounded-full px-2 py-0.5 text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-1 text-foreground-subtle hover:text-red-500 focus:outline-none"
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
          control={form.control}
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
          control={form.control}
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
      <Tabs
        value={authTab}
        onValueChange={(value) => {
          if (editingHost?.isShared) return;
          const newAuthType = value as
            | "password"
            | "key"
            | "credential"
            | "none";
          setAuthTab(newAuthType);
          form.setValue("authType", newAuthType);
        }}
        className="flex-1 flex flex-col h-full min-h-0"
      >
        <TabsList className="bg-button border border-edge-medium">
          <TabsTrigger
            value="password"
            disabled={editingHost?.isShared}
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("hosts.password")}
          </TabsTrigger>
          <TabsTrigger
            value="key"
            disabled={editingHost?.isShared}
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("hosts.key")}
          </TabsTrigger>
          <TabsTrigger
            value="credential"
            disabled={editingHost?.isShared}
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("hosts.credential")}
          </TabsTrigger>
          <TabsTrigger
            value="none"
            disabled={editingHost?.isShared}
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("hosts.none")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.password")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder={t("placeholders.password")}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </TabsContent>
        <TabsContent value="key">
          <Tabs
            value={keyInputMethod}
            onValueChange={(value) => {
              setKeyInputMethod(value as "upload" | "paste");
              if (value === "upload") {
                form.setValue("key", null);
              } else {
                form.setValue("key", "");
              }
            }}
            className="w-full"
          >
            <TabsList className="inline-flex items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
              <TabsTrigger value="upload">{t("hosts.uploadFile")}</TabsTrigger>
              <TabsTrigger value="paste">{t("hosts.pasteKey")}</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="mt-4">
              <Controller
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem className="mb-4">
                    <FormLabel>{t("hosts.sshPrivateKey")}</FormLabel>
                    <FormControl>
                      <div className="relative inline-block">
                        <input
                          id="key-upload"
                          type="file"
                          accept=".pem,.key,.txt,.ppk"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            field.onChange(file || null);
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="justify-start text-left"
                        >
                          <span
                            className="truncate"
                            title={
                              (field.value as File)?.name || t("hosts.upload")
                            }
                          >
                            {field.value === "existing_key"
                              ? t("hosts.existingKey")
                              : field.value
                                ? editingHost
                                  ? t("hosts.updateKey")
                                  : (field.value as File).name
                                : t("hosts.upload")}
                          </span>
                        </Button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
            </TabsContent>
            <TabsContent value="paste" className="mt-4">
              <Controller
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem className="mb-4">
                    <FormLabel>{t("hosts.sshPrivateKey")}</FormLabel>
                    <FormControl>
                      <CodeMirror
                        value={
                          typeof field.value === "string" ? field.value : ""
                        }
                        onChange={(value) => field.onChange(value)}
                        placeholder={t("placeholders.pastePrivateKey")}
                        theme={editorTheme}
                        className="border border-input rounded-md overflow-hidden"
                        minHeight="120px"
                        basicSetup={{
                          lineNumbers: true,
                          foldGutter: false,
                          dropCursor: false,
                          allowMultipleSelections: false,
                          highlightSelectionMatches: false,
                        }}
                        extensions={[
                          EditorView.theme({
                            ".cm-scroller": {
                              overflow: "auto",
                              scrollbarWidth: "thin",
                              scrollbarColor:
                                "var(--scrollbar-thumb) var(--scrollbar-track)",
                            },
                          }),
                        ]}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </TabsContent>
          </Tabs>
          <div className="grid grid-cols-15 gap-4 mt-4">
            <FormField
              control={form.control}
              name="keyPassword"
              render={({ field }) => (
                <FormItem className="col-span-8">
                  <FormLabel>{t("hosts.keyPassword")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={t("placeholders.keyPassword")}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="keyType"
              render={({ field }) => (
                <FormItem className="relative col-span-3">
                  <FormLabel>{t("hosts.keyType")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Button
                        ref={keyTypeButtonRef}
                        type="button"
                        variant="outline"
                        className="w-full justify-start text-left rounded-md px-2 py-2 bg-canvas border border-input text-foreground"
                        onClick={() => setKeyTypeDropdownOpen((open) => !open)}
                      >
                        {keyTypeOptions.find((opt) => opt.value === field.value)
                          ?.label || t("hosts.autoDetect")}
                      </Button>
                      {keyTypeDropdownOpen && (
                        <div
                          ref={keyTypeDropdownRef}
                          className="absolute bottom-full left-0 z-50 mb-1 w-full bg-canvas border border-input rounded-md shadow-lg max-h-40 overflow-y-auto thin-scrollbar p-1"
                        >
                          <div className="grid grid-cols-1 gap-1 p-0">
                            {keyTypeOptions.map((opt) => (
                              <Button
                                key={opt.value}
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start text-left rounded-md px-2 py-1.5 bg-canvas text-foreground hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                                onClick={() => {
                                  field.onChange(opt.value);
                                  setKeyTypeDropdownOpen(false);
                                }}
                              >
                                {opt.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </TabsContent>
        <TabsContent value="credential">
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="credentialId"
              render={({ field }) => (
                <FormItem>
                  {editingHost?.isShared ? (
                    <div className="text-sm text-muted-foreground p-3 bg-base border border-edge-medium rounded-md">
                      {t("hosts.cannotChangeAuthAsSharedUser")}
                    </div>
                  ) : (
                    <CredentialSelector
                      value={field.value}
                      onValueChange={field.onChange}
                      onCredentialSelect={(credential) => {
                        if (
                          credential &&
                          !form.getValues("overrideCredentialUsername")
                        ) {
                          form.setValue("username", credential.username);
                        }
                      }}
                    />
                  )}
                  {!editingHost?.isShared && (
                    <FormDescription>
                      {t("hosts.credentialDescription")}
                    </FormDescription>
                  )}
                </FormItem>
              )}
            />
            {form.watch("credentialId") && (
              <FormField
                control={form.control}
                name="overrideCredentialUsername"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                    <div className="space-y-0.5">
                      <FormLabel>
                        {t("hosts.overrideCredentialUsername")}
                      </FormLabel>
                      <FormDescription>
                        {t("hosts.overrideCredentialUsernameDesc")}
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
            )}
          </div>
        </TabsContent>
        <TabsContent value="none">
          <Alert className="mt-2">
            <AlertDescription>
              <strong>{t("hosts.noneAuthTitle")}</strong>
              <div className="mt-2">{t("hosts.noneAuthDescription")}</div>
              <div className="mt-2 text-sm">{t("hosts.noneAuthDetails")}</div>
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
      <Separator className="my-6" />
      <Accordion type="multiple" className="w-full">
        <AccordionItem value="advanced-auth">
          <AccordionTrigger>{t("hosts.advancedAuthSettings")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <FormField
              control={form.control}
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
              control={form.control}
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
              control={form.control}
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

            {form.watch("useSocks5") && (
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
                      control={form.control}
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
                      control={form.control}
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
                      control={form.control}
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
                      control={form.control}
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
                          const currentChain =
                            form.watch("socks5ProxyChain") || [];
                          form.setValue("socks5ProxyChain", [
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

                    {(form.watch("socks5ProxyChain") || []).length === 0 && (
                      <div className="text-sm text-muted-foreground text-center p-4 border rounded-lg border-dashed">
                        {t("hosts.noProxyNodes")}
                      </div>
                    )}

                    {(form.watch("socks5ProxyChain") || []).map(
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
                                  form.watch("socks5ProxyChain") || [];
                                form.setValue(
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
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    host: e.target.value,
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
                                }}
                                onBlur={(e) => {
                                  const currentChain =
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    host: e.target.value.trim(),
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
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
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    port: parseInt(e.target.value) || 1080,
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
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
                                  form.watch("socks5ProxyChain") || [];
                                const newChain = [...currentChain];
                                newChain[index] = {
                                  ...newChain[index],
                                  type: parseInt(value) as 4 | 5,
                                };
                                form.setValue("socks5ProxyChain", newChain);
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
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    username: e.target.value,
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
                                }}
                                onBlur={(e) => {
                                  const currentChain =
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    username: e.target.value.trim(),
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
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
                                    form.watch("socks5ProxyChain") || [];
                                  const newChain = [...currentChain];
                                  newChain[index] = {
                                    ...newChain[index],
                                    password: e.target.value,
                                  };
                                  form.setValue("socks5ProxyChain", newChain);
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
    </div>
  );
}
