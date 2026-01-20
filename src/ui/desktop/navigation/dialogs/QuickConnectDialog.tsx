import React, { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { CredentialSelector } from "@/ui/desktop/apps/host-manager/credentials/CredentialSelector.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { quickConnect, getCredentials } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { githubLight } from "@uiw/codemirror-theme-github";
import { EditorView } from "@codemirror/view";
import { useTheme } from "@/components/theme-provider.tsx";
import type { SSHHost, Credential } from "@/types";

interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const keyTypeOptions = [
  { value: "auto", label: "Auto Detect" },
  { value: "ssh-rsa", label: "RSA" },
  { value: "ssh-ed25519", label: "Ed25519" },
  { value: "ecdsa-sha2-nistp256", label: "ECDSA NIST P-256" },
  { value: "ecdsa-sha2-nistp384", label: "ECDSA NIST P-384" },
  { value: "ecdsa-sha2-nistp521", label: "ECDSA NIST P-521" },
  { value: "ssh-dss", label: "DSA" },
  { value: "ssh-rsa-sha2-256", label: "RSA SHA2-256" },
  { value: "ssh-rsa-sha2-512", label: "RSA SHA2-512" },
];

export function QuickConnectDialog({
  open,
  onOpenChange,
}: QuickConnectDialogProps) {
  const { t } = useTranslation();
  const { theme: appTheme } = useTheme();
  const { addTab, setCurrentTab } = useTabs();
  const [authTab, setAuthTab] = useState<"password" | "key" | "credential">(
    "password",
  );
  const [keyInputMethod, setKeyInputMethod] = useState<"upload" | "paste">(
    "upload",
  );
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [keyTypeDropdownOpen, setKeyTypeDropdownOpen] = useState(false);
  const keyTypeButtonRef = useRef<HTMLButtonElement>(null);
  const keyTypeDropdownRef = useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const isDarkMode =
    appTheme === "dark" ||
    (appTheme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorTheme = isDarkMode ? oneDark : githubLight;

  const formSchema = z
    .object({
      ip: z.string().min(1, t("quickConnect.ipAddress")),
      port: z.coerce.number().min(1).max(65535).default(22),
      username: z.string().min(1, t("quickConnect.username")),
      authType: z.enum(["password", "key", "credential"]),
      password: z.string().optional(),
      key: z.any().optional(),
      keyPassword: z.string().optional(),
      keyType: z
        .enum([
          "auto",
          "ssh-rsa",
          "ssh-ed25519",
          "ecdsa-sha2-nistp256",
          "ecdsa-sha2-nistp384",
          "ecdsa-sha2-nistp521",
          "ssh-dss",
          "ssh-rsa-sha2-256",
          "ssh-rsa-sha2-512",
        ])
        .optional(),
      credentialId: z.number().optional().nullable(),
      overrideCredentialUsername: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.authType === "password") {
        if (
          !data.password ||
          (typeof data.password === "string" && data.password.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("quickConnect.passwordRequired"),
            path: ["password"],
          });
        }
      } else if (data.authType === "key") {
        if (
          !data.key ||
          (typeof data.key === "string" && data.key.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("quickConnect.keyRequired"),
            path: ["key"],
          });
        }
        if (!data.keyType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("hosts.keyTypeRequired"),
            path: ["keyType"],
          });
        }
      } else if (data.authType === "credential") {
        if (!data.credentialId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("quickConnect.credentialRequired"),
            path: ["credentialId"],
          });
        }
      }
    });

  type FormData = z.infer<typeof formSchema>;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    mode: "all",
    defaultValues: {
      ip: "",
      port: 22,
      username: "",
      authType: "password" as const,
      password: "",
      key: null,
      keyPassword: "",
      keyType: "auto" as const,
      credentialId: null,
      overrideCredentialUsername: false,
    },
  });

  useEffect(() => {
    const fetchCredentials = async () => {
      try {
        const data = await getCredentials();
        setCredentials((data as Credential[]) || []);
      } catch (error) {
        console.error("Failed to fetch credentials:", error);
      }
    };

    if (open) {
      fetchCredentials();
    }
  }, [open]);

  useEffect(() => {
    form.setValue("authType", authTab, { shouldValidate: true });

    if (authTab === "password") {
      form.setValue("key", null, { shouldValidate: true });
      form.setValue("keyPassword", "", { shouldValidate: true });
      form.setValue("keyType", "auto", { shouldValidate: true });
      form.setValue("credentialId", null, { shouldValidate: true });
    } else if (authTab === "key") {
      form.setValue("password", "", { shouldValidate: true });
      form.setValue("credentialId", null, { shouldValidate: true });
    } else if (authTab === "credential") {
      form.setValue("password", "", { shouldValidate: true });
      form.setValue("key", null, { shouldValidate: true });
      form.setValue("keyPassword", "", { shouldValidate: true });
      form.setValue("keyType", "auto", { shouldValidate: true });
    }
  }, [authTab, form]);

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

  const handleConnect = async (connectionType: "terminal" | "file_manager") => {
    const formData = form.getValues();

    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }

    setIsConnecting(true);

    try {
      let keyContent: string | undefined;
      if (formData.authType === "key" && formData.key) {
        if (formData.key instanceof File) {
          keyContent = await formData.key.text();
        } else if (typeof formData.key === "string") {
          keyContent = formData.key;
        }
      }

      const hostConfig = await quickConnect({
        ip: formData.ip,
        port: formData.port,
        username: formData.username,
        authType: formData.authType,
        password:
          formData.authType === "password" ? formData.password : undefined,
        key: formData.authType === "key" ? keyContent : undefined,
        keyPassword:
          formData.authType === "key" ? formData.keyPassword : undefined,
        keyType: formData.authType === "key" ? formData.keyType : undefined,
        credentialId:
          formData.authType === "credential"
            ? formData.credentialId
            : undefined,
        overrideCredentialUsername:
          formData.authType === "credential"
            ? formData.overrideCredentialUsername
            : undefined,
      });

      const tabId = addTab({
        type: connectionType,
        title: `${formData.username}@${formData.ip}:${formData.port}`,
        hostConfig: hostConfig as SSHHost,
      });
      setCurrentTab(tabId);

      form.reset();
      setAuthTab("password");
      setKeyInputMethod("upload");
      onOpenChange(false);
    } catch (error) {
      console.error("Quick connect failed:", error);
      toast.error(
        t("quickConnect.connectionFailed") +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-canvas border-2 border-edge max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("quickConnect.title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("quickConnect.description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-12 gap-4">
              <FormField
                control={form.control}
                name="ip"
                render={({ field }) => (
                  <FormItem className="col-span-8">
                    <FormLabel className="text-base font-semibold text-foreground">
                      {t("quickConnect.ipAddress")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("placeholders.ipAddress")}
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
                name="port"
                render={({ field }) => (
                  <FormItem className="col-span-4">
                    <FormLabel className="text-base font-semibold text-foreground">
                      {t("quickConnect.port")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder={t("placeholders.port")}
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => {
                const isCredentialAuth = authTab === "credential";
                const hasCredential = !!form.watch("credentialId");
                const overrideEnabled = !!form.watch(
                  "overrideCredentialUsername",
                );
                const shouldDisable =
                  isCredentialAuth && hasCredential && !overrideEnabled;

                return (
                  <FormItem>
                    <FormLabel className="text-base font-semibold text-foreground">
                      {t("quickConnect.username")}
                    </FormLabel>
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

            <div className="space-y-3">
              <Label className="text-base font-semibold text-foreground">
                {t("quickConnect.authentication")}
              </Label>
              <Tabs
                value={authTab}
                onValueChange={(value) =>
                  setAuthTab(value as "password" | "key" | "credential")
                }
                className="w-full"
              >
                <TabsList className="inline-flex items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                  <TabsTrigger value="password">
                    {t("hosts.password")}
                  </TabsTrigger>
                  <TabsTrigger value="key">{t("hosts.key")}</TabsTrigger>
                  <TabsTrigger value="credential">
                    {t("quickConnect.credential")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="mt-4">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("quickConnect.password")}</FormLabel>
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

                <TabsContent value="key" className="mt-4">
                  <Tabs
                    value={keyInputMethod}
                    onValueChange={(value) =>
                      setKeyInputMethod(value as "upload" | "paste")
                    }
                    className="w-full"
                  >
                    <TabsList className="inline-flex items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                      <TabsTrigger value="upload">
                        {t("quickConnect.uploadFile")}
                      </TabsTrigger>
                      <TabsTrigger value="paste">
                        {t("quickConnect.pasteKey")}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="upload" className="mt-4">
                      <Controller
                        control={form.control}
                        name="key"
                        render={({ field }) => (
                          <FormItem className="mb-4">
                            <FormLabel>{t("quickConnect.key")}</FormLabel>
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
                                      (field.value as File)?.name ||
                                      t("hosts.upload")
                                    }
                                  >
                                    {field.value
                                      ? (field.value as File).name
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
                            <FormLabel>{t("quickConnect.key")}</FormLabel>
                            <FormControl>
                              <CodeMirror
                                value={
                                  typeof field.value === "string"
                                    ? field.value
                                    : ""
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

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <FormField
                      control={form.control}
                      name="keyPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("quickConnect.keyPassword")}</FormLabel>
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
                        <FormItem className="relative">
                          <FormLabel>{t("quickConnect.keyType")}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Button
                                ref={keyTypeButtonRef}
                                type="button"
                                variant="outline"
                                className="w-full justify-start text-left rounded-md px-2 py-2 bg-canvas border border-input text-foreground"
                                onClick={() =>
                                  setKeyTypeDropdownOpen((open) => !open)
                                }
                              >
                                {keyTypeOptions.find(
                                  (opt) => opt.value === field.value,
                                )?.label || t("quickConnect.autoDetect")}
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

                <TabsContent value="credential" className="mt-4">
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="credentialId"
                      render={({ field }) => (
                        <FormItem>
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
                                {t("quickConnect.overrideUsername")}
                              </FormLabel>
                              <p className="text-sm text-muted-foreground">
                                {t("quickConnect.overrideUsernameDesc")}
                              </p>
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
              </Tabs>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isConnecting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => handleConnect("terminal")}
              disabled={isConnecting}
            >
              {t("quickConnect.connectTerminal")}
            </Button>
            <Button
              onClick={() => handleConnect("file_manager")}
              disabled={isConnecting}
            >
              {t("quickConnect.connectFileManager")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
