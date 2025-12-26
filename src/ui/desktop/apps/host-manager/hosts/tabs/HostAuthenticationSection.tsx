import React, { useRef, useState, useEffect } from "react";
import { Controller } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { CredentialSelector } from "@/ui/desktop/apps/host-manager/credentials/CredentialSelector.tsx";
import type { HostAuthenticationSectionProps } from "./shared/tab-types";

export function HostAuthenticationSection({
  control,
  watch,
  setValue,
  credentials,
  authTab,
  setAuthTab,
  keyInputMethod,
  setKeyInputMethod,
  editorTheme,
  editingHost,
  t,
}: HostAuthenticationSectionProps) {
  const [keyTypeDropdownOpen, setKeyTypeDropdownOpen] = useState(false);
  const keyTypeButtonRef = useRef<HTMLButtonElement>(null);
  const keyTypeDropdownRef = useRef<HTMLDivElement>(null);

  const keyTypeOptions = [
    { value: "auto", label: t("hosts.autoDetect") },
    { value: "ssh-rsa", label: t("hosts.rsa") },
    { value: "ssh-ed25519", label: t("hosts.ed25519") },
    { value: "ecdsa-sha2-nistp256", label: t("hosts.ecdsaNistP256") },
    { value: "ecdsa-sha2-nistp384", label: t("hosts.ecdsaNistP384") },
    { value: "ecdsa-sha2-nistp521", label: t("hosts.ecdsaNistP521") },
    { value: "ssh-dss", label: t("hosts.dsa") },
    { value: "ssh-rsa-sha2-256", label: t("hosts.rsaSha2256") },
    { value: "ssh-rsa-sha2-512", label: t("hosts.rsaSha2512") },
  ];

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (
        keyTypeDropdownOpen &&
        keyTypeDropdownRef.current &&
        !keyTypeDropdownRef.current.contains(event.target as Node) &&
        keyTypeButtonRef.current &&
        !keyTypeButtonRef.current.contains(event.target as Node)
      ) {
        setKeyTypeDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [keyTypeDropdownOpen]);

  return (
    <Tabs
      value={authTab}
      onValueChange={(value) => {
        const newAuthType = value as "password" | "key" | "credential" | "none";
        setAuthTab(newAuthType);
        setValue("authType", newAuthType);
      }}
      className="flex-1 flex flex-col h-full min-h-0"
    >
      <TabsList className="bg-button border border-edge-medium">
        <TabsTrigger
          value="password"
          className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
        >
          {t("hosts.password")}
        </TabsTrigger>
        <TabsTrigger
          value="key"
          className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
        >
          {t("hosts.key")}
        </TabsTrigger>
        <TabsTrigger
          value="credential"
          className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
        >
          {t("hosts.credential")}
        </TabsTrigger>
        <TabsTrigger
          value="none"
          className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
        >
          {t("hosts.none")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="password">
        <FormField
          control={control}
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
              setValue("key", null);
            } else {
              setValue("key", "");
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
              control={control}
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
              control={control}
              name="key"
              render={({ field }) => (
                <FormItem className="mb-4">
                  <FormLabel>{t("hosts.sshPrivateKey")}</FormLabel>
                  <FormControl>
                    <CodeMirror
                      value={typeof field.value === "string" ? field.value : ""}
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
            control={control}
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
            control={control}
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
                              className="w-full justify-start text-left rounded-md px-2 py-1.5 bg-canvas text-foreground hover:bg-white/15 focus:bg-white/20 focus:outline-none"
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
            control={control}
            name="credentialId"
            render={({ field }) => (
              <FormItem>
                <CredentialSelector
                  value={field.value}
                  onValueChange={field.onChange}
                  onCredentialSelect={(credential) => {
                    if (credential && !watch("overrideCredentialUsername")) {
                      setValue("username", credential.username);
                    }
                  }}
                />
                <FormDescription>
                  {t("hosts.credentialDescription")}
                </FormDescription>
              </FormItem>
            )}
          />
          {watch("credentialId") && (
            <FormField
              control={control}
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
  );
}
