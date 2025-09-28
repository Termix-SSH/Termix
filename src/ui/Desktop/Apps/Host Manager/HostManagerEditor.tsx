import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button.tsx";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import React, { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { toast } from "sonner";
import {
  createSSHHost,
  getCredentials,
  getSSHHosts,
  updateSSHHost,
  enableAutoStart,
  disableAutoStart,
} from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { CredentialSelector } from "@/ui/Desktop/Apps/Credentials/CredentialSelector.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: any[];
  createdAt: string;
  updatedAt: string;
  credentialId?: number;
}

interface SSHManagerHostEditorProps {
  editingHost?: SSHHost | null;
  onFormSubmit?: (updatedHost?: SSHHost) => void;
}

export function HostManagerEditor({
  editingHost,
  onFormSubmit,
}: SSHManagerHostEditorProps) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sshConfigurations, setSshConfigurations] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [authTab, setAuthTab] = useState<"password" | "key" | "credential">(
    "password",
  );
  const [keyInputMethod, setKeyInputMethod] = useState<"upload" | "paste">(
    "upload",
  );
  const isSubmittingRef = useRef(false);

  const ipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [hostsData, credentialsData] = await Promise.all([
          getSSHHosts(),
          getCredentials(),
        ]);
        setHosts(hostsData);
        setCredentials(credentialsData);

        const uniqueFolders = [
          ...new Set(
            hostsData
              .filter((host) => host.folder && host.folder.trim() !== "")
              .map((host) => host.folder),
          ),
        ].sort();

        const uniqueConfigurations = [
          ...new Set(
            hostsData
              .filter((host) => host.name && host.name.trim() !== "")
              .map((host) => host.name),
          ),
        ].sort();

        setFolders(uniqueFolders);
        setSshConfigurations(uniqueConfigurations);
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    const handleCredentialChange = async () => {
      try {
        setLoading(true);
        const hostsData = await getSSHHosts();
        setHosts(hostsData);

        const uniqueFolders = [
          ...new Set(
            hostsData
              .filter((host) => host.folder && host.folder.trim() !== "")
              .map((host) => host.folder),
          ),
        ].sort();

        const uniqueConfigurations = [
          ...new Set(
            hostsData
              .filter((host) => host.name && host.name.trim() !== "")
              .map((host) => host.name),
          ),
        ].sort();

        setFolders(uniqueFolders);
        setSshConfigurations(uniqueConfigurations);
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };

    window.addEventListener("credentials:changed", handleCredentialChange);

    return () => {
      window.removeEventListener("credentials:changed", handleCredentialChange);
    };
  }, []);

  const formSchema = z
    .object({
      name: z.string().optional(),
      ip: z.string().min(1),
      port: z.coerce.number().min(1).max(65535),
      username: z.string().min(1),
      folder: z.string().optional(),
      tags: z.array(z.string().min(1)).default([]),
      pin: z.boolean().default(false),
      authType: z.enum(["password", "key", "credential"]),
      credentialId: z.number().optional().nullable(),
      password: z.string().optional(),
      key: z.any().optional().nullable(),
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
      enableTerminal: z.boolean().default(true),
      enableTunnel: z.boolean().default(true),
      tunnelConnections: z
        .array(
          z.object({
            sourcePort: z.coerce.number().min(1).max(65535),
            endpointPort: z.coerce.number().min(1).max(65535),
            endpointHost: z.string().min(1),
            maxRetries: z.coerce.number().min(0).max(100).default(3),
            retryInterval: z.coerce.number().min(1).max(3600).default(10),
            autoStart: z.boolean().default(false),
          }),
        )
        .default([]),
      enableFileManager: z.boolean().default(true),
      defaultPath: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.authType === "key") {
        if (
          !data.key ||
          (typeof data.key === "string" && data.key.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("hosts.sshKeyRequired"),
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
        if (
          !data.credentialId ||
          (typeof data.credentialId === "string" &&
            data.credentialId.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("hosts.credentialRequired"),
            path: ["credentialId"],
          });
        }
      }

      data.tunnelConnections.forEach((connection, index) => {
        if (
          connection.endpointHost &&
          !sshConfigurations.includes(connection.endpointHost)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("hosts.mustSelectValidSshConfig"),
            path: ["tunnelConnections", index, "endpointHost"],
          });
        }
      });
    });

  type FormData = z.infer<typeof formSchema>;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: "",
      ip: "",
      port: 22,
      username: "",
      folder: "",
      tags: [],
      pin: false,
      authType: "password" as const,
      credentialId: null,
      password: "",
      key: null,
      keyPassword: "",
      keyType: "auto" as const,
      enableTerminal: true,
      enableTunnel: true,
      enableFileManager: true,
      defaultPath: "/",
      tunnelConnections: [],
    },
  });

  useEffect(() => {
    if (authTab === "credential") {
      const currentCredentialId = form.getValues("credentialId");
      if (currentCredentialId) {
        const selectedCredential = credentials.find(
          (c) => c.id === currentCredentialId,
        );
        if (selectedCredential) {
          form.setValue("username", selectedCredential.username);
        }
      }
    }
  }, [authTab, credentials, form]);

  useEffect(() => {
    if (editingHost) {
      const cleanedHost = { ...editingHost };
      if (cleanedHost.credentialId && cleanedHost.key) {
        cleanedHost.key = undefined;
        cleanedHost.keyPassword = undefined;
        cleanedHost.keyType = undefined;
      } else if (cleanedHost.credentialId && cleanedHost.password) {
        cleanedHost.password = undefined;
      } else if (cleanedHost.key && cleanedHost.password) {
        cleanedHost.password = undefined;
      }

      const defaultAuthType = cleanedHost.credentialId
        ? "credential"
        : cleanedHost.key
          ? "key"
          : "password";
      setAuthTab(defaultAuthType);

      const formData = {
        name: cleanedHost.name || "",
        ip: cleanedHost.ip || "",
        port: cleanedHost.port || 22,
        username: cleanedHost.username || "",
        folder: cleanedHost.folder || "",
        tags: cleanedHost.tags || [],
        pin: Boolean(cleanedHost.pin),
        authType: defaultAuthType as "password" | "key" | "credential",
        credentialId: null,
        password: "",
        key: null,
        keyPassword: "",
        keyType: "auto" as const,
        enableTerminal: Boolean(cleanedHost.enableTerminal),
        enableTunnel: Boolean(cleanedHost.enableTunnel),
        enableFileManager: Boolean(cleanedHost.enableFileManager),
        defaultPath: cleanedHost.defaultPath || "/",
        tunnelConnections: cleanedHost.tunnelConnections || [],
      };

      if (defaultAuthType === "password") {
        formData.password = cleanedHost.password || "";
      } else if (defaultAuthType === "key") {
        formData.key = editingHost.id ? "existing_key" : editingHost.key;
        formData.keyPassword = cleanedHost.keyPassword || "";
        formData.keyType = (cleanedHost.keyType as any) || "auto";
      } else if (defaultAuthType === "credential") {
        formData.credentialId =
          cleanedHost.credentialId || "existing_credential";
      }

      form.reset(formData);
    } else {
      setAuthTab("password");
      const defaultFormData = {
        name: "",
        ip: "",
        port: 22,
        username: "",
        folder: "",
        tags: [],
        pin: false,
        authType: "password" as const,
        credentialId: null,
        password: "",
        key: null,
        keyPassword: "",
        keyType: "auto" as const,
        enableTerminal: true,
        enableTunnel: true,
        enableFileManager: true,
        defaultPath: "/",
        tunnelConnections: [],
      };

      form.reset(defaultFormData);
    }
  }, [editingHost?.id]);

  useEffect(() => {
    const focusTimer = setTimeout(() => {
      if (ipInputRef.current) {
        ipInputRef.current.focus();
      }
    }, 300);

    return () => clearTimeout(focusTimer);
  }, [editingHost]);

  const onSubmit = async (data: FormData) => {
    try {
      isSubmittingRef.current = true;

      if (!data.name || data.name.trim() === "") {
        data.name = `${data.username}@${data.ip}`;
      }

      const submitData: any = {
        name: data.name,
        ip: data.ip,
        port: data.port,
        username: data.username,
        folder: data.folder || "",
        tags: data.tags || [],
        pin: Boolean(data.pin),
        authType: data.authType,
        enableTerminal: Boolean(data.enableTerminal),
        enableTunnel: Boolean(data.enableTunnel),
        enableFileManager: Boolean(data.enableFileManager),
        defaultPath: data.defaultPath || "/",
        tunnelConnections: data.tunnelConnections || [],
      };

      submitData.credentialId = null;
      submitData.password = null;
      submitData.key = null;
      submitData.keyPassword = null;
      submitData.keyType = null;

      if (data.authType === "credential") {
        if (
          data.credentialId === "existing_credential" &&
          editingHost &&
          editingHost.id
        ) {
          delete submitData.credentialId;
        } else {
          submitData.credentialId = data.credentialId;
        }
      } else if (data.authType === "password") {
        submitData.password = data.password;
      } else if (data.authType === "key") {
        if (data.key instanceof File) {
          const keyContent = await data.key.text();
          submitData.key = keyContent;
        } else if (data.key === "existing_key") {
          delete submitData.key;
        } else {
          submitData.key = data.key;
        }
        submitData.keyPassword = data.keyPassword;
        submitData.keyType = data.keyType;
      }

      let savedHost;
      if (editingHost && editingHost.id) {
        savedHost = await updateSSHHost(editingHost.id, submitData);
        toast.success(t("hosts.hostUpdatedSuccessfully", { name: data.name }));
      } else {
        savedHost = await createSSHHost(submitData);
        toast.success(t("hosts.hostAddedSuccessfully", { name: data.name }));
      }

      if (savedHost && savedHost.id && data.tunnelConnections) {
        const hasAutoStartTunnels = data.tunnelConnections.some(
          (tunnel) => tunnel.autoStart,
        );

        if (hasAutoStartTunnels) {
          try {
            await enableAutoStart(savedHost.id);
          } catch (error) {
            console.warn(
              `Failed to enable AutoStart plaintext cache for SSH host ${savedHost.id}:`,
              error,
            );
            toast.warning(
              t("hosts.autoStartEnableFailed", { name: data.name }),
            );
          }
        } else {
          try {
            await disableAutoStart(savedHost.id);
          } catch (error) {
            console.warn(
              `Failed to disable AutoStart plaintext cache for SSH host ${savedHost.id}:`,
              error,
            );
          }
        }
      }

      if (onFormSubmit) {
        onFormSubmit(savedHost);
      }

      window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));

      form.reset();
    } catch (error) {
      toast.error(t("hosts.failedToSaveHost"));
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const [tagInput, setTagInput] = useState("");

  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);

  const folderValue = form.watch("folder");
  const filteredFolders = React.useMemo(() => {
    if (!folderValue) return folders;
    return folders.filter((f) =>
      f.toLowerCase().includes(folderValue.toLowerCase()),
    );
  }, [folderValue, folders]);

  const handleFolderClick = (folder: string) => {
    form.setValue("folder", folder);
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

  const [keyTypeDropdownOpen, setKeyTypeDropdownOpen] = useState(false);
  const keyTypeButtonRef = useRef<HTMLButtonElement>(null);
  const keyTypeDropdownRef = useRef<HTMLDivElement>(null);

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

  const [sshConfigDropdownOpen, setSshConfigDropdownOpen] = useState<{
    [key: number]: boolean;
  }>({});
  const sshConfigInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>(
    {},
  );
  const sshConfigDropdownRefs = useRef<{
    [key: number]: HTMLDivElement | null;
  }>({});

  const getFilteredSshConfigs = (index: number) => {
    const value = form.watch(`tunnelConnections.${index}.endpointHost`);

    const currentHostName =
      form.watch("name") || `${form.watch("username")}@${form.watch("ip")}`;

    let filtered = sshConfigurations.filter(
      (config) => config !== currentHostName,
    );

    if (value) {
      filtered = filtered.filter((config) =>
        config.toLowerCase().includes(value.toLowerCase()),
      );
    }

    return filtered;
  };

  const handleSshConfigClick = (config: string, index: number) => {
    form.setValue(`tunnelConnections.${index}.endpointHost`, config);
    setSshConfigDropdownOpen((prev) => ({ ...prev, [index]: false }));
  };

  useEffect(() => {
    function handleSshConfigClickOutside(event: MouseEvent) {
      const openDropdowns = Object.keys(sshConfigDropdownOpen).filter(
        (key) => sshConfigDropdownOpen[parseInt(key)],
      );

      openDropdowns.forEach((indexStr: string) => {
        const index = parseInt(indexStr);
        if (
          sshConfigDropdownRefs.current[index] &&
          !sshConfigDropdownRefs.current[index]?.contains(
            event.target as Node,
          ) &&
          sshConfigInputRefs.current[index] &&
          !sshConfigInputRefs.current[index]?.contains(event.target as Node)
        ) {
          setSshConfigDropdownOpen((prev) => ({ ...prev, [index]: false }));
        }
      });
    }

    const hasOpenDropdowns = Object.values(sshConfigDropdownOpen).some(
      (open) => open,
    );

    if (hasOpenDropdowns) {
      document.addEventListener("mousedown", handleSshConfigClickOutside);
    } else {
      document.removeEventListener("mousedown", handleSshConfigClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleSshConfigClickOutside);
    };
  }, [sshConfigDropdownOpen]);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col flex-1 min-h-0 h-full"
        >
          <ScrollArea className="flex-1 min-h-0 w-full my-1 pb-2">
            <Tabs defaultValue="general" className="w-full">
              <TabsList>
                <TabsTrigger value="general">{t("hosts.general")}</TabsTrigger>
                <TabsTrigger value="terminal">
                  {t("hosts.terminal")}
                </TabsTrigger>
                <TabsTrigger value="tunnel">{t("hosts.tunnel")}</TabsTrigger>
                <TabsTrigger value="file_manager">
                  {t("hosts.fileManager")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="general" className="pt-2">
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
                          <Input
                            placeholder={t("placeholders.port")}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem className="col-span-6">
                        <FormLabel>{t("hosts.username")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("placeholders.username")}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
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
                          />
                        </FormControl>
                        {folderDropdownOpen && filteredFolders.length > 0 && (
                          <div
                            ref={folderDropdownRef}
                            className="absolute top-full left-0 z-50 mt-1 w-full bg-dark-bg border border-input rounded-md shadow-lg max-h-40 overflow-y-auto p-1"
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
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem className="col-span-10 overflow-visible">
                        <FormLabel>{t("hosts.tags")}</FormLabel>
                        <FormControl>
                          <div className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-dark-bg-input focus-within:ring-2 ring-ring min-h-[40px]">
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
                              className="flex-1 min-w-[60px] border-none outline-none bg-transparent p-0 h-6"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === " " && tagInput.trim() !== "") {
                                  e.preventDefault();
                                  if (!field.value.includes(tagInput.trim())) {
                                    field.onChange([
                                      ...field.value,
                                      tagInput.trim(),
                                    ]);
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
                </div>
                <FormLabel className="mb-3 mt-3 font-bold">
                  {t("hosts.authentication")}
                </FormLabel>
                <Tabs
                  value={authTab}
                  onValueChange={(value) => {
                    const newAuthType = value as
                      | "password"
                      | "key"
                      | "credential";
                    setAuthTab(newAuthType);
                    form.setValue("authType", newAuthType);

                    if (newAuthType === "password") {
                      form.setValue("key", null);
                      form.setValue("keyPassword", "");
                      form.setValue("keyType", "auto");
                      form.setValue("credentialId", null);
                    } else if (newAuthType === "key") {
                      form.setValue("password", "");
                      form.setValue("credentialId", null);
                    } else if (newAuthType === "credential") {
                      form.setValue("password", "");
                      form.setValue("key", null);
                      form.setValue("keyPassword", "");
                      form.setValue("keyType", "auto");
                    }
                  }}
                  className="flex-1 flex flex-col h-full min-h-0"
                >
                  <TabsList>
                    <TabsTrigger value="password">
                      {t("hosts.password")}
                    </TabsTrigger>
                    <TabsTrigger value="key">{t("hosts.key")}</TabsTrigger>
                    <TabsTrigger value="credential">
                      {t("hosts.credential")}
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
                        <TabsTrigger value="upload">
                          {t("hosts.uploadFile")}
                        </TabsTrigger>
                        <TabsTrigger value="paste">
                          {t("hosts.pasteKey")}
                        </TabsTrigger>
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
                                        field.value?.name || t("hosts.upload")
                                      }
                                    >
                                      {field.value === "existing_key"
                                        ? t("hosts.existingKey")
                                        : field.value
                                          ? editingHost
                                            ? t("hosts.updateKey")
                                            : field.value.name
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
                                    typeof field.value === "string"
                                      ? field.value
                                      : ""
                                  }
                                  onChange={(value) => field.onChange(value)}
                                  placeholder={t(
                                    "placeholders.pastePrivateKey",
                                  )}
                                  theme={oneDark}
                                  className="border border-input rounded-md"
                                  minHeight="120px"
                                  basicSetup={{
                                    lineNumbers: true,
                                    foldGutter: false,
                                    dropCursor: false,
                                    allowMultipleSelections: false,
                                    highlightSelectionMatches: false,
                                    searchKeymap: false,
                                    scrollPastEnd: false,
                                  }}
                                  extensions={[
                                    EditorView.theme({
                                      ".cm-scroller": {
                                        overflow: "auto",
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
                                  className="w-full justify-start text-left rounded-md px-2 py-2 bg-dark-bg border border-input text-foreground"
                                  onClick={() =>
                                    setKeyTypeDropdownOpen((open) => !open)
                                  }
                                >
                                  {keyTypeOptions.find(
                                    (opt) => opt.value === field.value,
                                  )?.label || t("hosts.autoDetect")}
                                </Button>
                                {keyTypeDropdownOpen && (
                                  <div
                                    ref={keyTypeDropdownRef}
                                    className="absolute bottom-full left-0 z-50 mb-1 w-full bg-dark-bg border border-input rounded-md shadow-lg max-h-40 overflow-y-auto p-1"
                                  >
                                    <div className="grid grid-cols-1 gap-1 p-0">
                                      {keyTypeOptions.map((opt) => (
                                        <Button
                                          key={opt.value}
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="w-full justify-start text-left rounded-md px-2 py-1.5 bg-dark-bg text-foreground hover:bg-white/15 focus:bg-white/20 focus:outline-none"
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
                    <FormField
                      control={form.control}
                      name="credentialId"
                      render={({ field }) => (
                        <FormItem>
                          <CredentialSelector
                            value={field.value}
                            onValueChange={field.onChange}
                            onCredentialSelect={(credential) => {
                              if (credential) {
                                form.setValue("username", credential.username);
                              }
                            }}
                          />
                          <FormDescription>
                            {t("hosts.credentialDescription")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                </Tabs>
              </TabsContent>
              <TabsContent value="terminal">
                <FormField
                  control={form.control}
                  name="enableTerminal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("hosts.enableTerminal")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("hosts.enableTerminalDesc")}
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </TabsContent>
              <TabsContent value="tunnel">
                <FormField
                  control={form.control}
                  name="enableTunnel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("hosts.enableTunnel")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("hosts.enableTunnelDesc")}
                      </FormDescription>
                    </FormItem>
                  )}
                />
                {form.watch("enableTunnel") && (
                  <>
                    <Alert className="mt-4">
                      <AlertDescription>
                        <strong>{t("hosts.sshpassRequired")}</strong>
                        <div>
                          {t("hosts.sshpassRequiredDesc")}{" "}
                          <code className="bg-muted px-1 rounded inline">
                            sudo apt install sshpass
                          </code>{" "}
                          {t("hosts.debianUbuntuEquivalent")}
                        </div>
                        <div className="mt-2">
                          <strong>{t("hosts.otherInstallMethods")}</strong>
                          <div>
                            • {t("hosts.centosRhelFedora")}{" "}
                            <code className="bg-muted px-1 rounded inline">
                              sudo yum install sshpass
                            </code>{" "}
                            {t("hosts.or")}{" "}
                            <code className="bg-muted px-1 rounded inline">
                              sudo dnf install sshpass
                            </code>
                          </div>
                          <div>
                            • {t("hosts.macos")}{" "}
                            <code className="bg-muted px-1 rounded inline">
                              brew install hudochenkov/sshpass/sshpass
                            </code>
                          </div>
                          <div>• {t("hosts.windows")}</div>
                        </div>
                      </AlertDescription>
                    </Alert>

                    <Alert className="mt-4">
                      <AlertDescription>
                        <strong>{t("hosts.sshServerConfigRequired")}</strong>
                        <div>{t("hosts.sshServerConfigDesc")}</div>
                        <div>
                          •{" "}
                          <code className="bg-muted px-1 rounded inline">
                            GatewayPorts yes
                          </code>{" "}
                          {t("hosts.gatewayPortsYes")}
                        </div>
                        <div>
                          •{" "}
                          <code className="bg-muted px-1 rounded inline">
                            AllowTcpForwarding yes
                          </code>{" "}
                          {t("hosts.allowTcpForwardingYes")}
                        </div>
                        <div>
                          •{" "}
                          <code className="bg-muted px-1 rounded inline">
                            PermitRootLogin yes
                          </code>{" "}
                          {t("hosts.permitRootLoginYes")}
                        </div>
                        <div className="mt-2">{t("hosts.editSshConfig")}</div>
                      </AlertDescription>
                    </Alert>
                    <div className="mt-3 flex justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() =>
                          window.open(
                            "https://docs.termix.site/tunnels",
                            "_blank",
                          )
                        }
                      >
                        {t("common.documentation")}
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name="tunnelConnections"
                      render={({ field }) => (
                        <FormItem className="mt-4">
                          <FormLabel>{t("hosts.tunnelConnections")}</FormLabel>
                          <FormControl>
                            <div className="space-y-4">
                              {field.value.map((connection, index) => (
                                <div
                                  key={index}
                                  className="p-4 border rounded-lg bg-muted/50"
                                >
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-bold">
                                      {t("hosts.connection")} {index + 1}
                                    </h4>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const newConnections =
                                          field.value.filter(
                                            (_, i) => i !== index,
                                          );
                                        field.onChange(newConnections);
                                      }}
                                    >
                                      {t("hosts.remove")}
                                    </Button>
                                  </div>
                                  <div className="grid grid-cols-12 gap-4">
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.sourcePort`}
                                      render={({ field: sourcePortField }) => (
                                        <FormItem className="col-span-4">
                                          <FormLabel>
                                            {t("hosts.sourcePort")}
                                            {t("hosts.sourcePortDesc")}
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              placeholder="22"
                                              {...sourcePortField}
                                            />
                                          </FormControl>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.endpointPort`}
                                      render={({
                                        field: endpointPortField,
                                      }) => (
                                        <FormItem className="col-span-4">
                                          <FormLabel>
                                            {t("hosts.endpointPort")}
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              placeholder="224"
                                              {...endpointPortField}
                                            />
                                          </FormControl>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.endpointHost`}
                                      render={({
                                        field: endpointHostField,
                                      }) => (
                                        <FormItem className="col-span-4 relative">
                                          <FormLabel>
                                            {t("hosts.endpointSshConfig")}
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              ref={(el) => {
                                                sshConfigInputRefs.current[
                                                  index
                                                ] = el;
                                              }}
                                              placeholder={t(
                                                "placeholders.sshConfig",
                                              )}
                                              className="min-h-[40px]"
                                              autoComplete="off"
                                              value={endpointHostField.value}
                                              onFocus={() =>
                                                setSshConfigDropdownOpen(
                                                  (prev) => ({
                                                    ...prev,
                                                    [index]: true,
                                                  }),
                                                )
                                              }
                                              onChange={(e) => {
                                                endpointHostField.onChange(e);
                                                setSshConfigDropdownOpen(
                                                  (prev) => ({
                                                    ...prev,
                                                    [index]: true,
                                                  }),
                                                );
                                              }}
                                            />
                                          </FormControl>
                                          {sshConfigDropdownOpen[index] &&
                                            getFilteredSshConfigs(index)
                                              .length > 0 && (
                                              <div
                                                ref={(el) => {
                                                  sshConfigDropdownRefs.current[
                                                    index
                                                  ] = el;
                                                }}
                                                className="absolute top-full left-0 z-50 mt-1 w-full bg-dark-bg border border-input rounded-md shadow-lg max-h-40 overflow-y-auto p-1"
                                              >
                                                <div className="grid grid-cols-1 gap-1 p-0">
                                                  {getFilteredSshConfigs(
                                                    index,
                                                  ).map((config) => (
                                                    <Button
                                                      key={config}
                                                      type="button"
                                                      variant="ghost"
                                                      size="sm"
                                                      className="w-full justify-start text-left rounded px-2 py-1.5 hover:bg-white/15 focus:bg-white/20 focus:outline-none"
                                                      onClick={() =>
                                                        handleSshConfigClick(
                                                          config,
                                                          index,
                                                        )
                                                      }
                                                    >
                                                      {config}
                                                    </Button>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                        </FormItem>
                                      )}
                                    />
                                  </div>

                                  <p className="text-sm text-muted-foreground mt-2">
                                    {t("hosts.tunnelForwardDescription", {
                                      sourcePort:
                                        form.watch(
                                          `tunnelConnections.${index}.sourcePort`,
                                        ) || "22",
                                      endpointPort:
                                        form.watch(
                                          `tunnelConnections.${index}.endpointPort`,
                                        ) || "224",
                                    })}
                                  </p>

                                  <div className="grid grid-cols-12 gap-4 mt-4">
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.maxRetries`}
                                      render={({ field: maxRetriesField }) => (
                                        <FormItem className="col-span-4">
                                          <FormLabel>
                                            {t("hosts.maxRetries")}
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              placeholder={t(
                                                "placeholders.maxRetries",
                                              )}
                                              {...maxRetriesField}
                                            />
                                          </FormControl>
                                          <FormDescription>
                                            {t("hosts.maxRetriesDescription")}
                                          </FormDescription>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.retryInterval`}
                                      render={({
                                        field: retryIntervalField,
                                      }) => (
                                        <FormItem className="col-span-4">
                                          <FormLabel>
                                            {t("hosts.retryInterval")}
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              placeholder={t(
                                                "placeholders.retryInterval",
                                              )}
                                              {...retryIntervalField}
                                            />
                                          </FormControl>
                                          <FormDescription>
                                            {t(
                                              "hosts.retryIntervalDescription",
                                            )}
                                          </FormDescription>
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`tunnelConnections.${index}.autoStart`}
                                      render={({ field }) => (
                                        <FormItem className="col-span-4">
                                          <FormLabel>
                                            {t("hosts.autoStartContainer")}
                                          </FormLabel>
                                          <FormControl>
                                            <Switch
                                              checked={field.value}
                                              onCheckedChange={field.onChange}
                                            />
                                          </FormControl>
                                          <FormDescription>
                                            {t("hosts.autoStartDesc")}
                                          </FormDescription>
                                        </FormItem>
                                      )}
                                    />
                                  </div>
                                </div>
                              ))}
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  field.onChange([
                                    ...field.value,
                                    {
                                      sourcePort: 22,
                                      endpointPort: 224,
                                      endpointHost: "",
                                      maxRetries: 3,
                                      retryInterval: 10,
                                      autoStart: false,
                                    },
                                  ]);
                                }}
                              >
                                {t("hosts.addConnection")}
                              </Button>
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </TabsContent>
              <TabsContent value="file_manager">
                <FormField
                  control={form.control}
                  name="enableFileManager"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("hosts.enableFileManager")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("hosts.enableFileManagerDesc")}
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {form.watch("enableFileManager") && (
                  <div className="mt-4">
                    <FormField
                      control={form.control}
                      name="defaultPath"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("hosts.defaultPath")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("placeholders.homePath")}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t("hosts.defaultPathDesc")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>
          <footer className="shrink-0 w-full pb-0">
            <Separator className="p-0.25" />
            <Button className="translate-y-2" type="submit" variant="outline">
              {editingHost
                ? editingHost.id
                  ? t("hosts.updateHost")
                  : t("hosts.cloneHost")
                : t("hosts.addHost")}
            </Button>
          </footer>
        </form>
      </Form>
    </div>
  );
}
