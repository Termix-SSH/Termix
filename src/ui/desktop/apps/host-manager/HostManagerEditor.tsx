import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { cn } from "@/lib/utils";

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
import { Textarea } from "@/components/ui/textarea.tsx";
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
  getSnippets,
} from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { CredentialSelector } from "@/ui/desktop/apps/credentials/CredentialSelector.tsx";
import { HostSharingTab } from "./HostSharingTab.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import type { StatsConfig } from "@/types/stats-widgets";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { Slider } from "@/components/ui/slider.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  CURSOR_STYLES,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
  DEFAULT_TERMINAL_CONFIG,
} from "@/constants/terminal-themes";
import { TerminalPreview } from "@/ui/desktop/apps/terminal/TerminalPreview.tsx";
import type { TerminalConfig, SSHHost, Credential } from "@/types";
import { Plus, X, Check, ChevronsUpDown, Save } from "lucide-react";

interface JumpHostItemProps {
  jumpHost: { hostId: number };
  index: number;
  hosts: SSHHost[];
  editingHost?: SSHHost | null;
  onUpdate: (hostId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}

function JumpHostItem({
  jumpHost,
  index,
  hosts,
  editingHost,
  onUpdate,
  onRemove,
  t,
}: JumpHostItemProps) {
  const [open, setOpen] = React.useState(false);
  const selectedHost = hosts.find((h) => h.id === jumpHost.hostId);

  return (
    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-sm font-medium text-muted-foreground">
          {index + 1}.
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild className="flex-1">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedHost
                ? `${selectedHost.name || `${selectedHost.username}@${selectedHost.ip}`}`
                : t("hosts.selectServer")}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: "var(--radix-popover-trigger-width)" }}
          >
            <Command>
              <CommandInput placeholder={t("hosts.searchServers")} />
              <CommandEmpty>{t("hosts.noServerFound")}</CommandEmpty>
              <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                {hosts
                  .filter((h) => !editingHost || h.id !== editingHost.id)
                  .map((host) => (
                    <CommandItem
                      key={host.id}
                      value={`${host.name} ${host.ip} ${host.username} ${host.id}`}
                      onSelect={() => {
                        onUpdate(host.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          jumpHost.hostId === host.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {host.name || `${host.username}@${host.ip}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {host.username}@{host.ip}:{host.port}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="ml-2"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface QuickActionItemProps {
  quickAction: { name: string; snippetId: number };
  index: number;
  snippets: Array<{ id: number; name: string; content: string }>;
  onUpdate: (name: string, snippetId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}

function QuickActionItem({
  quickAction,
  index,
  snippets,
  onUpdate,
  onRemove,
  t,
}: QuickActionItemProps) {
  const [open, setOpen] = React.useState(false);
  const selectedSnippet = snippets.find((s) => s.id === quickAction.snippetId);

  return (
    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
      <div className="flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {index + 1}.
          </span>
          <Input
            placeholder={t("hosts.quickActionName")}
            value={quickAction.name}
            onChange={(e) => onUpdate(e.target.value, quickAction.snippetId)}
            onBlur={(e) =>
              onUpdate(e.target.value.trim(), quickAction.snippetId)
            }
            className="flex-1"
          />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild className="w-full">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedSnippet
                ? selectedSnippet.name
                : t("hosts.selectSnippet")}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: "var(--radix-popover-trigger-width)" }}
          >
            <Command>
              <CommandInput placeholder={t("hosts.searchSnippets")} />
              <CommandEmpty>{t("hosts.noSnippetFound")}</CommandEmpty>
              <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                {snippets.map((snippet) => (
                  <CommandItem
                    key={snippet.id}
                    value={`${snippet.name} ${snippet.content} ${snippet.id}`}
                    onSelect={() => {
                      onUpdate(quickAction.name, snippet.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        quickAction.snippetId === snippet.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{snippet.name}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                        {snippet.content}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="ml-2"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
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
  const [folders, setFolders] = useState<string[]>([]);
  const [sshConfigurations, setSshConfigurations] = useState<string[]>([]);
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [snippets, setSnippets] = useState<
    Array<{ id: number; name: string; content: string }>
  >([]);
  const [proxyMode, setProxyMode] = useState<"single" | "chain">("single");

  const [authTab, setAuthTab] = useState<
    "password" | "key" | "credential" | "none"
  >("password");
  const [keyInputMethod, setKeyInputMethod] = useState<"upload" | "paste">(
    "upload",
  );
  const isSubmittingRef = useRef(false);
  const [activeTab, setActiveTab] = useState("general");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setFormError(null);
  }, [activeTab]);

  const [statusIntervalUnit, setStatusIntervalUnit] = useState<
    "seconds" | "minutes"
  >("seconds");
  const [metricsIntervalUnit, setMetricsIntervalUnit] = useState<
    "seconds" | "minutes"
  >("seconds");

  const ipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [hostsData, credentialsData, snippetsData] = await Promise.all([
          getSSHHosts(),
          getCredentials(),
          getSnippets(),
        ]);
        setHosts(hostsData);
        setCredentials(credentialsData as Credential[]);
        setSnippets(Array.isArray(snippetsData) ? snippetsData : []);

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
        console.error("Host manager operation failed:", error);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    const handleCredentialChange = async () => {
      try {
        const hostsData = await getSSHHosts();

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
        console.error("Host manager operation failed:", error);
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
      authType: z.enum(["password", "key", "credential", "none"]),
      credentialId: z.number().optional().nullable(),
      overrideCredentialUsername: z.boolean().optional(),
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
      statsConfig: z
        .object({
          enabledWidgets: z
            .array(
              z.enum([
                "cpu",
                "memory",
                "disk",
                "network",
                "uptime",
                "processes",
                "system",
                "login_stats",
                "ports",
              ]),
            )
            .default([
              "cpu",
              "memory",
              "disk",
              "network",
              "uptime",
              "system",
              "login_stats",
            ]),
          statusCheckEnabled: z.boolean().default(true),
          statusCheckInterval: z.number().min(5).max(3600).default(30),
          metricsEnabled: z.boolean().default(true),
          metricsInterval: z.number().min(5).max(3600).default(30),
        })
        .default({
          enabledWidgets: [
            "cpu",
            "memory",
            "disk",
            "network",
            "uptime",
            "system",
            "login_stats",
          ],
          statusCheckEnabled: true,
          statusCheckInterval: 30,
          metricsEnabled: true,
          metricsInterval: 30,
        }),
      terminalConfig: z
        .object({
          cursorBlink: z.boolean(),
          cursorStyle: z.enum(["block", "underline", "bar"]),
          fontSize: z.number().min(8).max(24),
          fontFamily: z.string(),
          letterSpacing: z.number().min(-2).max(10),
          lineHeight: z.number().min(1.0).max(2.0),
          theme: z.string(),
          scrollback: z.number().min(1000).max(50000),
          bellStyle: z.enum(["none", "sound", "visual", "both"]),
          rightClickSelectsWord: z.boolean(),
          fastScrollModifier: z.enum(["alt", "ctrl", "shift"]),
          fastScrollSensitivity: z.number().min(1).max(10),
          minimumContrastRatio: z.number().min(1).max(21),
          backspaceMode: z.enum(["normal", "control-h"]),
          agentForwarding: z.boolean(),
          environmentVariables: z.array(
            z.object({
              key: z.string(),
              value: z.string(),
            }),
          ),
          startupSnippetId: z.number().nullable(),
          autoMosh: z.boolean(),
          moshCommand: z.string(),
          sudoPasswordAutoFill: z.boolean(),
          sudoPassword: z.string().optional(),
        })
        .optional(),
      forceKeyboardInteractive: z.boolean().optional(),
      jumpHosts: z
        .array(
          z.object({
            hostId: z.number().min(1),
          }),
        )
        .default([]),
      quickActions: z
        .array(
          z.object({
            name: z.string().min(1),
            snippetId: z.number().min(1),
          }),
        )
        .default([]),
      notes: z.string().optional(),
      useSocks5: z.boolean().optional(),
      socks5Host: z.string().optional(),
      socks5Port: z.coerce.number().min(1).max(65535).optional(),
      socks5Username: z.string().optional(),
      socks5Password: z.string().optional(),
      socks5ProxyChain: z
        .array(
          z.object({
            host: z.string().min(1),
            port: z.number().min(1).max(65535),
            type: z.union([z.literal(4), z.literal(5)]),
            username: z.string().optional(),
            password: z.string().optional(),
          }),
        )
        .optional(),
      enableDocker: z.boolean().default(false),
    })
    .superRefine((data, ctx) => {
      if (data.authType === "none") {
        return;
      }

      if (data.authType === "password") {
        if (
          !data.password ||
          (typeof data.password === "string" && data.password.trim() === "")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("hosts.passwordRequired"),
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
        if (!data.credentialId) {
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
      overrideCredentialUsername: false,
      password: "",
      key: null,
      keyPassword: "",
      keyType: "auto" as const,
      enableTerminal: true,
      enableTunnel: true,
      enableFileManager: true,
      defaultPath: "/",
      tunnelConnections: [],
      jumpHosts: [],
      quickActions: [],
      statsConfig: DEFAULT_STATS_CONFIG,
      terminalConfig: DEFAULT_TERMINAL_CONFIG,
      forceKeyboardInteractive: false,
      notes: "",
      useSocks5: false,
      socks5Host: "",
      socks5Port: 1080,
      socks5Username: "",
      socks5Password: "",
      socks5ProxyChain: [],
      enableDocker: false,
    },
  });

  useEffect(() => {
    if (authTab === "credential") {
      const currentCredentialId = form.getValues("credentialId");
      const overrideUsername = form.getValues("overrideCredentialUsername");
      if (currentCredentialId && !overrideUsername) {
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
          : cleanedHost.password
            ? "password"
            : "none";
      setAuthTab(defaultAuthType);

      let parsedStatsConfig: StatsConfig = DEFAULT_STATS_CONFIG;
      try {
        if (cleanedHost.statsConfig) {
          parsedStatsConfig =
            typeof cleanedHost.statsConfig === "string"
              ? JSON.parse(cleanedHost.statsConfig)
              : (cleanedHost.statsConfig as StatsConfig);
        }
      } catch (error) {
        console.error("Failed to parse statsConfig:", error);
      }

      parsedStatsConfig = { ...DEFAULT_STATS_CONFIG, ...parsedStatsConfig };

      const formData: Partial<FormData> = {
        name: cleanedHost.name || "",
        ip: cleanedHost.ip || "",
        port: cleanedHost.port || 22,
        username: cleanedHost.username || "",
        folder: cleanedHost.folder || "",
        tags: Array.isArray(cleanedHost.tags) ? cleanedHost.tags : [],
        pin: Boolean(cleanedHost.pin),
        authType: defaultAuthType as "password" | "key" | "credential" | "none",
        credentialId: cleanedHost.credentialId,
        overrideCredentialUsername: Boolean(
          cleanedHost.overrideCredentialUsername,
        ),
        password: "",
        key: null,
        keyPassword: "",
        keyType: "auto" as const,
        enableTerminal: Boolean(cleanedHost.enableTerminal),
        enableTunnel: Boolean(cleanedHost.enableTunnel),
        enableFileManager: Boolean(cleanedHost.enableFileManager),
        defaultPath: cleanedHost.defaultPath || "/",
        tunnelConnections: Array.isArray(cleanedHost.tunnelConnections)
          ? cleanedHost.tunnelConnections
          : [],
        jumpHosts: Array.isArray(cleanedHost.jumpHosts)
          ? cleanedHost.jumpHosts
          : [],
        quickActions: Array.isArray(cleanedHost.quickActions)
          ? cleanedHost.quickActions
          : [],
        statsConfig: parsedStatsConfig,
        terminalConfig: {
          ...DEFAULT_TERMINAL_CONFIG,
          ...(cleanedHost.terminalConfig || {}),
          environmentVariables: Array.isArray(
            cleanedHost.terminalConfig?.environmentVariables,
          )
            ? cleanedHost.terminalConfig.environmentVariables
            : [],
        },
        forceKeyboardInteractive: Boolean(cleanedHost.forceKeyboardInteractive),
        notes: cleanedHost.notes || "",
        useSocks5: Boolean(cleanedHost.useSocks5),
        socks5Host: cleanedHost.socks5Host || "",
        socks5Port: cleanedHost.socks5Port || 1080,
        socks5Username: cleanedHost.socks5Username || "",
        socks5Password: cleanedHost.socks5Password || "",
        socks5ProxyChain: Array.isArray(cleanedHost.socks5ProxyChain)
          ? cleanedHost.socks5ProxyChain
          : [],
        enableDocker: Boolean(cleanedHost.enableDocker),
      };

      // Determine proxy mode based on existing data
      if (
        Array.isArray(cleanedHost.socks5ProxyChain) &&
        cleanedHost.socks5ProxyChain.length > 0
      ) {
        setProxyMode("chain");
      } else {
        setProxyMode("single");
      }

      if (defaultAuthType === "password") {
        formData.password = cleanedHost.password || "";
      } else if (defaultAuthType === "key") {
        formData.key = editingHost.id ? "existing_key" : editingHost.key;
        formData.keyPassword = cleanedHost.keyPassword || "";
        formData.keyType =
          (cleanedHost.keyType as
            | "auto"
            | "ssh-rsa"
            | "ssh-ed25519"
            | "ecdsa-sha2-nistp256"
            | "ecdsa-sha2-nistp384"
            | "ecdsa-sha2-nistp521"
            | "ssh-dss"
            | "ssh-rsa-sha2-256"
            | "ssh-rsa-sha2-512") || "auto";
      } else if (defaultAuthType === "credential") {
        formData.credentialId = cleanedHost.credentialId;
      }

      form.reset(formData as FormData);
    } else {
      setAuthTab("password");
      const defaultFormData: Partial<FormData> = {
        name: "",
        ip: "",
        port: 22,
        username: "",
        folder: "",
        tags: [],
        pin: false,
        authType: "password" as const,
        credentialId: null,
        overrideCredentialUsername: false,
        password: "",
        key: null,
        keyPassword: "",
        keyType: "auto" as const,
        enableTerminal: true,
        enableTunnel: true,
        enableFileManager: true,
        defaultPath: "/",
        tunnelConnections: [],
        jumpHosts: [],
        quickActions: [],
        statsConfig: DEFAULT_STATS_CONFIG,
        terminalConfig: DEFAULT_TERMINAL_CONFIG,
        forceKeyboardInteractive: false,
        enableDocker: false,
      };

      form.reset(defaultFormData as FormData);
    }
  }, [editingHost, form]);

  useEffect(() => {
    const focusTimer = setTimeout(() => {
      if (ipInputRef.current) {
        ipInputRef.current.focus();
      }
    }, 300);

    return () => clearTimeout(focusTimer);
  }, [editingHost]);

  const onSubmit = async (data: FormData) => {
    await form.trigger();
    console.log("onSubmit called with data:", data);
    try {
      isSubmittingRef.current = true;
      setFormError(null);

      if (!data.name || data.name.trim() === "") {
        data.name = `${data.username}@${data.ip}`;
      }

      if (data.statsConfig) {
        const statusInterval = data.statsConfig.statusCheckInterval || 30;
        const metricsInterval = data.statsConfig.metricsInterval || 30;

        if (statusInterval < 5 || statusInterval > 3600) {
          toast.error(t("hosts.intervalValidation"));
          setActiveTab("statistics");
          setFormError(t("hosts.intervalValidation"));
          isSubmittingRef.current = false;
          return;
        }

        if (metricsInterval < 5 || metricsInterval > 3600) {
          toast.error(t("hosts.intervalValidation"));
          setActiveTab("statistics");
          setFormError(t("hosts.intervalValidation"));
          isSubmittingRef.current = false;
          return;
        }
      }

      const submitData: Partial<SSHHost> = {
        ...data,
      };

      if (data.authType !== "credential") {
        submitData.credentialId = undefined;
      }
      if (data.authType !== "password") {
        submitData.password = undefined;
      }
      if (data.authType !== "key") {
        submitData.key = undefined;
        submitData.keyPassword = undefined;
        submitData.keyType = undefined;
      }

      if (data.authType === "key") {
        if (data.key instanceof File) {
          submitData.key = await data.key.text();
        } else if (data.key === "existing_key") {
          delete submitData.key;
        }
      }

      let savedHost;
      if (editingHost && editingHost.id) {
        savedHost = await updateSSHHost(editingHost.id, submitData as any);
        toast.success(t("hosts.hostUpdatedSuccessfully", { name: data.name }));
      } else {
        savedHost = await createSSHHost(submitData as any);
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

      if (savedHost?.id) {
        const { notifyHostCreatedOrUpdated } =
          await import("@/ui/main-axios.ts");
        notifyHostCreatedOrUpdated(savedHost.id);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(t("hosts.failedToSaveHost") + ": " + errorMessage);
      console.error("Failed to save host:", error);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleFormError = () => {
    const errors = form.formState.errors;

    if (
      errors.ip ||
      errors.port ||
      errors.username ||
      errors.name ||
      errors.folder ||
      errors.tags ||
      errors.pin ||
      errors.password ||
      errors.key ||
      errors.keyPassword ||
      errors.keyType ||
      errors.credentialId ||
      errors.forceKeyboardInteractive ||
      errors.jumpHosts
    ) {
      setActiveTab("general");
    } else if (errors.enableTerminal || errors.terminalConfig) {
      setActiveTab("terminal");
    } else if (errors.enableDocker) {
      setActiveTab("docker");
    } else if (errors.enableTunnel || errors.tunnelConnections) {
      setActiveTab("tunnel");
    } else if (errors.enableFileManager || errors.defaultPath) {
      setActiveTab("file_manager");
    } else if (errors.statsConfig) {
      setActiveTab("statistics");
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

    const currentHostId = editingHost?.id;

    let filtered = sshConfigurations;

    if (currentHostId) {
      const currentHostName = hosts.find((h) => h.id === currentHostId)?.name;
      if (currentHostName) {
        filtered = sshConfigurations.filter(
          (config) => config !== currentHostName,
        );
      }
    } else {
      const currentHostName =
        form.watch("name") || `${form.watch("username")}@${form.watch("ip")}`;
      filtered = sshConfigurations.filter(
        (config) => config !== currentHostName,
      );
    }

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
          onSubmit={form.handleSubmit(onSubmit, handleFormError)}
          className="flex flex-col flex-1 min-h-0 h-full"
        >
          <ScrollArea className="flex-1 min-h-0 w-full my-1 pb-2">
            <div className="pr-4">
              {formError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="w-full"
              >
                <TabsList className="bg-button border border-edge-medium">
                  <TabsTrigger value="general" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                    {t("hosts.general")}
                  </TabsTrigger>
                  <TabsTrigger value="terminal" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                    {t("hosts.terminal")}
                  </TabsTrigger>
                  <TabsTrigger value="docker" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">Docker</TabsTrigger>
                  <TabsTrigger value="tunnel" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">{t("hosts.tunnel")}</TabsTrigger>
                  <TabsTrigger value="file_manager" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                    {t("hosts.fileManager")}
                  </TabsTrigger>
                  <TabsTrigger value="statistics" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                    {t("hosts.statistics")}
                  </TabsTrigger>
                  {!editingHost?.isShared && (
                    <TabsTrigger value="sharing">
                      {t("rbac.sharing")}
                    </TabsTrigger>
                  )}
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
                      render={({ field }) => {
                        const isCredentialAuth = authTab === "credential";
                        const hasCredential = !!form.watch("credentialId");
                        const overrideEnabled = !!form.watch(
                          "overrideCredentialUsername",
                        );
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
                                className="flex-1 min-w-[60px] border-none outline-none bg-transparent p-0 h-6"
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === " " && tagInput.trim() !== "") {
                                    e.preventDefault();
                                    if (
                                      !field.value.includes(tagInput.trim())
                                    ) {
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
                      <TabsTrigger value="password" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                        {t("hosts.password")}
                      </TabsTrigger>
                      <TabsTrigger value="key" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">{t("hosts.key")}</TabsTrigger>
                      <TabsTrigger value="credential" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">
                        {t("hosts.credential")}
                      </TabsTrigger>
                      <TabsTrigger value="none" className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium">{t("hosts.none")}</TabsTrigger>
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
                                <FormLabel>
                                  {t("hosts.sshPrivateKey")}
                                </FormLabel>
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
                                <FormLabel>
                                  {t("hosts.sshPrivateKey")}
                                </FormLabel>
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
                                    }}
                                    extensions={[
                                      EditorView.theme({
                                        ".cm-scroller": {
                                          overflow: "auto",
                                          scrollbarWidth: "thin",
                                          scrollbarColor: "var(--scrollbar-thumb) var(--scrollbar-track)",
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
                                    !form.getValues(
                                      "overrideCredentialUsername",
                                    )
                                  ) {
                                    form.setValue(
                                      "username",
                                      credential.username,
                                    );
                                  }
                                }}
                              />
                              <FormDescription>
                                {t("hosts.credentialDescription")}
                              </FormDescription>
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
                          <div className="mt-2">
                            {t("hosts.noneAuthDescription")}
                          </div>
                          <div className="mt-2 text-sm">
                            {t("hosts.noneAuthDetails")}
                          </div>
                        </AlertDescription>
                      </Alert>
                    </TabsContent>
                  </Tabs>
                  <Separator className="my-6" />
                  <Accordion type="multiple" className="w-full">
                    <AccordionItem value="advanced-auth">
                      <AccordionTrigger>
                        {t("hosts.advancedAuthSettings")}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-4">
                        <FormField
                          control={form.control}
                          name="forceKeyboardInteractive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                              <div className="space-y-0.5">
                                <FormLabel>
                                  {t("hosts.forceKeyboardInteractive")}
                                </FormLabel>
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
                      <AccordionTrigger>
                        {t("hosts.jumpHosts")}
                      </AccordionTrigger>
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
                                      field.onChange([
                                        ...field.value,
                                        { hostId: 0 },
                                      ]);
                                    }}
                                  >
                                    <Plus className="h-4 w-4 mr-2" />
                                    {t("hosts.addJumpHost")}
                                  </Button>
                                </div>
                              </FormControl>
                              <FormDescription>
                                {t("hosts.jumpHostsOrder")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="socks5">
                      <AccordionTrigger>
                        {t("hosts.socks5Proxy")}
                      </AccordionTrigger>
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
                              <FormLabel>
                                {t("hosts.socks5ProxyMode")}
                              </FormLabel>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant={
                                    proxyMode === "single"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() => setProxyMode("single")}
                                  className="flex-1"
                                >
                                  {t("hosts.socks5UseSingleProxy")}
                                </Button>
                                <Button
                                  type="button"
                                  variant={
                                    proxyMode === "chain"
                                      ? "default"
                                      : "outline"
                                  }
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
                                      <FormLabel>
                                        {t("hosts.socks5Host")}
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder={t("placeholders.socks5Host")}
                                          {...field}
                                          onBlur={(e) => {
                                            field.onChange(
                                              e.target.value.trim(),
                                            );
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
                                      <FormLabel>
                                        {t("hosts.socks5Port")}
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          placeholder={t("placeholders.socks5Port")}
                                          {...field}
                                          onChange={(e) =>
                                            field.onChange(
                                              parseInt(e.target.value) || 1080,
                                            )
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
                                            field.onChange(
                                              e.target.value.trim(),
                                            );
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
                                  <FormLabel>
                                    {t("hosts.socks5ProxyChain")}
                                  </FormLabel>
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

                                {(form.watch("socks5ProxyChain") || [])
                                  .length === 0 && (
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
                                              form.watch("socks5ProxyChain") ||
                                              [];
                                            form.setValue(
                                              "socks5ProxyChain",
                                              currentChain.filter(
                                                (_: any, i: number) =>
                                                  i !== index,
                                              ),
                                            );
                                          }}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>

                                      <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                          <FormLabel>
                                            {t("hosts.socks5Host")}
                                          </FormLabel>
                                          <Input
                                            placeholder={t("placeholders.socks5Host")}
                                            value={node.host}
                                            onChange={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                host: e.target.value,
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
                                            }}
                                            onBlur={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                host: e.target.value.trim(),
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
                                            }}
                                          />
                                        </div>

                                        <div className="space-y-2">
                                          <FormLabel>
                                            {t("hosts.socks5Port")}
                                          </FormLabel>
                                          <Input
                                            type="number"
                                            placeholder={t("placeholders.socks5Port")}
                                            value={node.port}
                                            onChange={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                port:
                                                  parseInt(e.target.value) ||
                                                  1080,
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
                                            }}
                                          />
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <FormLabel>
                                          {t("hosts.proxyType")}
                                        </FormLabel>
                                        <Select
                                          value={String(node.type)}
                                          onValueChange={(value) => {
                                            const currentChain =
                                              form.watch("socks5ProxyChain") ||
                                              [];
                                            const newChain = [...currentChain];
                                            newChain[index] = {
                                              ...newChain[index],
                                              type: parseInt(value) as 4 | 5,
                                            };
                                            form.setValue(
                                              "socks5ProxyChain",
                                              newChain,
                                            );
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
                                            {t("hosts.socks5Username")} {t("hosts.optional")}
                                          </FormLabel>
                                          <Input
                                            placeholder={t("hosts.username")}
                                            value={node.username || ""}
                                            onChange={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                username: e.target.value,
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
                                            }}
                                            onBlur={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                username: e.target.value.trim(),
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
                                            }}
                                          />
                                        </div>

                                        <div className="space-y-2">
                                          <FormLabel>
                                            {t("hosts.socks5Password")} {t("hosts.optional")}
                                          </FormLabel>
                                          <PasswordInput
                                            placeholder={t("hosts.password")}
                                            value={node.password || ""}
                                            onChange={(e) => {
                                              const currentChain =
                                                form.watch(
                                                  "socks5ProxyChain",
                                                ) || [];
                                              const newChain = [
                                                ...currentChain,
                                              ];
                                              newChain[index] = {
                                                ...newChain[index],
                                                password: e.target.value,
                                              };
                                              form.setValue(
                                                "socks5ProxyChain",
                                                newChain,
                                              );
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
                </TabsContent>

                <TabsContent value="terminal">
                  <Accordion
                    type="multiple"
                    className="w-full"
                    defaultValue={["appearance", "behavior", "advanced"]}
                  >
                    <AccordionItem value="appearance">
                      <AccordionTrigger>
                        {t("hosts.appearance")}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-4">
                        <FormField
                          control={form.control}
                          name="terminalConfig.letterSpacing"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.letterSpacingValue", {
                                  value: field.value,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Slider
                                  min={-2}
                                  max={10}
                                  step={0.5}
                                  value={[field.value]}
                                  onValueChange={([value]) =>
                                    field.onChange(value)
                                  }
                                />
                              </FormControl>
                              <FormDescription>
                                {t("hosts.adjustLetterSpacing")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.lineHeight"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.lineHeightValue", {
                                  value: field.value,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Slider
                                  min={1}
                                  max={2}
                                  step={0.1}
                                  value={[field.value]}
                                  onValueChange={([value]) =>
                                    field.onChange(value)
                                  }
                                />
                              </FormControl>
                              <FormDescription>
                                {t("hosts.adjustLineHeight")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.cursorStyle"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("hosts.cursorStyle")}</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t("hosts.selectCursorStyle")}
                                    />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="block">
                                    {t("hosts.cursorStyleBlock")}
                                  </SelectItem>
                                  <SelectItem value="underline">
                                    {t("hosts.cursorStyleUnderline")}
                                  </SelectItem>
                                  <SelectItem value="bar">
                                    {t("hosts.cursorStyleBar")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                {t("hosts.chooseCursorAppearance")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.cursorBlink"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                              <div className="space-y-0.5">
                                <FormLabel>{t("hosts.cursorBlink")}</FormLabel>
                                <FormDescription>
                                  {t("hosts.enableCursorBlink")}
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

                    <AccordionItem value="behavior">
                      <AccordionTrigger>{t("hosts.behavior")}</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-4">
                        <FormField
                          control={form.control}
                          name="terminalConfig.scrollback"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.scrollbackBufferValue", {
                                  value: field.value,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Slider
                                  min={1000}
                                  max={100000}
                                  step={1000}
                                  value={[field.value]}
                                  onValueChange={([value]) =>
                                    field.onChange(value)
                                  }
                                />
                              </FormControl>
                              <FormDescription>
                                {t("hosts.scrollbackBufferDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.bellStyle"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("hosts.bellStyle")}</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t("hosts.selectBellStyle")}
                                    />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none">
                                    {t("hosts.bellStyleNone")}
                                  </SelectItem>
                                  <SelectItem value="sound">
                                    {t("hosts.bellStyleSound")}
                                  </SelectItem>
                                  <SelectItem value="visual">
                                    {t("hosts.bellStyleVisual")}
                                  </SelectItem>
                                  <SelectItem value="both">
                                    {t("hosts.bellStyleBoth")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                {t("hosts.bellStyleDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.rightClickSelectsWord"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                              <div className="space-y-0.5">
                                <FormLabel>
                                  {t("hosts.rightClickSelectsWord")}
                                </FormLabel>
                                <FormDescription>
                                  {t("hosts.rightClickSelectsWordDesc")}
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

                        <FormField
                          control={form.control}
                          name="terminalConfig.fastScrollModifier"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.fastScrollModifier")}
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t("hosts.selectModifier")}
                                    />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="alt">
                                    {t("hosts.modifierAlt")}
                                  </SelectItem>
                                  <SelectItem value="ctrl">
                                    {t("hosts.modifierCtrl")}
                                  </SelectItem>
                                  <SelectItem value="shift">
                                    {t("hosts.modifierShift")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                {t("hosts.fastScrollModifierDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.fastScrollSensitivity"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.fastScrollSensitivityValue", {
                                  value: field.value,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Slider
                                  min={1}
                                  max={10}
                                  step={1}
                                  value={[field.value]}
                                  onValueChange={([value]) =>
                                    field.onChange(value)
                                  }
                                />
                              </FormControl>
                              <FormDescription>
                                {t("hosts.fastScrollSensitivityDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.minimumContrastRatio"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                {t("hosts.minimumContrastRatioValue", {
                                  value: field.value,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Slider
                                  min={1}
                                  max={21}
                                  step={1}
                                  value={[field.value]}
                                  onValueChange={([value]) =>
                                    field.onChange(value)
                                  }
                                />
                              </FormControl>
                              <FormDescription>
                                {t("hosts.minimumContrastRatioDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="advanced">
                      <AccordionTrigger>{t("hosts.advanced")}</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-4">
                        <FormField
                          control={form.control}
                          name="terminalConfig.agentForwarding"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                              <div className="space-y-0.5">
                                <FormLabel>
                                  {t("hosts.sshAgentForwarding")}
                                </FormLabel>
                                <FormDescription>
                                  {t("hosts.sshAgentForwardingDesc")}
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

                        <FormField
                          control={form.control}
                          name="terminalConfig.backspaceMode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("hosts.backspaceMode")}</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t(
                                        "hosts.selectBackspaceMode",
                                      )}
                                    />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="normal">
                                    {t("hosts.backspaceModeNormal")}
                                  </SelectItem>
                                  <SelectItem value="control-h">
                                    {t("hosts.backspaceModeControlH")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                {t("hosts.backspaceModeDesc")}
                              </FormDescription>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.startupSnippetId"
                          render={({ field }) => {
                            const [open, setOpen] = React.useState(false);
                            const selectedSnippet = snippets.find(
                              (s) => s.id === field.value,
                            );

                            return (
                              <FormItem>
                                <FormLabel>
                                  {t("hosts.startupSnippet")}
                                </FormLabel>
                                <Popover open={open} onOpenChange={setOpen}>
                                  <PopoverTrigger asChild>
                                    <FormControl>
                                      <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={open}
                                        className="w-full justify-between"
                                      >
                                        {selectedSnippet
                                          ? selectedSnippet.name
                                          : t("hosts.selectSnippet")}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                      </Button>
                                    </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="p-0"
                                    style={{
                                      width:
                                        "var(--radix-popover-trigger-width)",
                                    }}
                                  >
                                    <Command>
                                      <CommandInput
                                        placeholder={t("hosts.searchSnippets")}
                                      />
                                      <CommandEmpty>
                                        {t("hosts.noSnippetFound")}
                                      </CommandEmpty>
                                      <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                                        <CommandItem
                                          value="none"
                                          onSelect={() => {
                                            field.onChange(null);
                                            setOpen(false);
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              !field.value
                                                ? "opacity-100"
                                                : "opacity-0",
                                            )}
                                          />
                                          {t("hosts.snippetNone")}
                                        </CommandItem>
                                        {snippets.map((snippet) => (
                                          <CommandItem
                                            key={snippet.id}
                                            value={`${snippet.name} ${snippet.content} ${snippet.id}`}
                                            onSelect={() => {
                                              field.onChange(snippet.id);
                                              setOpen(false);
                                            }}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                field.value === snippet.id
                                                  ? "opacity-100"
                                                  : "opacity-0",
                                              )}
                                            />
                                            <div className="flex flex-col">
                                              <span className="font-medium">
                                                {snippet.name}
                                              </span>
                                              <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                                                {snippet.content}
                                              </span>
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                <FormDescription>
                                  {t("hosts.executeSnippetOnConnect")}
                                </FormDescription>
                              </FormItem>
                            );
                          }}
                        />

                        <FormField
                          control={form.control}
                          name="terminalConfig.autoMosh"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                              <div className="space-y-0.5">
                                <FormLabel>{t("hosts.autoMosh")}</FormLabel>
                                <FormDescription>
                                  {t("hosts.autoMoshDesc")}
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

                        {form.watch("terminalConfig.autoMosh") && (
                          <FormField
                            control={form.control}
                            name="terminalConfig.moshCommand"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("hosts.moshCommand")}</FormLabel>
                                <FormControl>
                                  <Input
                                                                              placeholder={t("placeholders.moshCommand")}                                    {...field}
                                    onBlur={(e) => {
                                      field.onChange(e.target.value.trim());
                                      field.onBlur();
                                    }}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t("hosts.moshCommandDesc")}
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                        )}

                        <FormField
                          control={form.control}
                          name="terminalConfig.sudoPasswordAutoFill"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                              <div className="space-y-0.5">
                                <FormLabel>
                                  {t("hosts.sudoPasswordAutoFill")}
                                </FormLabel>
                                <FormDescription>
                                  {t("hosts.sudoPasswordAutoFillDesc")}
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

                        {form.watch("terminalConfig.sudoPasswordAutoFill") && (
                          <FormField
                            control={form.control}
                            name="terminalConfig.sudoPassword"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("hosts.sudoPassword")}</FormLabel>
                                <FormControl>
                                  <PasswordInput
                                    placeholder={t("placeholders.sudoPassword")}
                                    {...field}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t("hosts.sudoPasswordDesc")}
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                        )}

                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            {t("hosts.environmentVariables")}
                          </label>
                          <FormDescription>
                            {t("hosts.environmentVariablesDesc")}
                          </FormDescription>
                          {form
                            .watch("terminalConfig.environmentVariables")
                            ?.map((_, index) => (
                              <div key={index} className="flex gap-2">
                                <FormField
                                  control={form.control}
                                  name={`terminalConfig.environmentVariables.${index}.key`}
                                  render={({ field }) => (
                                    <FormItem className="flex-1">
                                      <FormControl>
                                        <Input
                                          placeholder={t("hosts.variableName")}
                                          {...field}
                                          onBlur={(e) => {
                                            field.onChange(
                                              e.target.value.trim(),
                                            );
                                            field.onBlur();
                                          }}
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name={`terminalConfig.environmentVariables.${index}.value`}
                                  render={({ field }) => (
                                    <FormItem className="flex-1">
                                      <FormControl>
                                        <Input
                                          placeholder={t("hosts.variableValue")}
                                          {...field}
                                          onBlur={(e) => {
                                            field.onChange(
                                              e.target.value.trim(),
                                            );
                                            field.onBlur();
                                          }}
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => {
                                    const current = form.getValues(
                                      "terminalConfig.environmentVariables",
                                    );
                                    form.setValue(
                                      "terminalConfig.environmentVariables",
                                      current.filter((_, i) => i !== index),
                                    );
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const current =
                                form.getValues(
                                  "terminalConfig.environmentVariables",
                                ) || [];
                              form.setValue(
                                "terminalConfig.environmentVariables",
                                [...current, { key: "", value: "" }],
                              );
                            }}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            {t("hosts.addVariable")}
                          </Button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </TabsContent>
                <TabsContent value="docker" className="space-y-4">
                  <FormField
                    control={form.control}
                    name="enableDocker"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("hosts.enableDocker")}</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("hosts.enableDockerDesc")}
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
                            <FormLabel>
                              {t("hosts.tunnelConnections")}
                            </FormLabel>
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
                                        render={({
                                          field: sourcePortField,
                                        }) => (
                                          <FormItem className="col-span-4">
                                            <FormLabel>
                                              {t("hosts.sourcePort")}
                                              {t("hosts.sourcePortDesc")}
                                            </FormLabel>
                                            <FormControl>
                                              <Input
                                                placeholder={t("placeholders.defaultPort")}
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
                                                placeholder={t("placeholders.defaultEndpointPort")}
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
                                                onBlur={(e) => {
                                                  endpointHostField.onChange(
                                                    e.target.value.trim(),
                                                  );
                                                  endpointHostField.onBlur();
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
                                                  className="absolute top-full left-0 z-50 mt-1 w-full bg-canvas border border-input rounded-md shadow-lg max-h-40 overflow-y-auto thin-scrollbar p-1"
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
                                        render={({
                                          field: maxRetriesField,
                                        }) => (
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
                                onBlur={(e) => {
                                  field.onChange(e.target.value.trim());
                                  field.onBlur();
                                }}
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
                <TabsContent value="statistics" className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() =>
                          window.open(
                            "https://docs.termix.site/server-stats",
                            "_blank",
                          )
                        }
                      >
                        {t("common.documentation")}
                      </Button>

                      <FormField
                        control={form.control}
                        name="statsConfig.statusCheckEnabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                            <div className="space-y-0.5">
                              <FormLabel>
                                {t("hosts.statusCheckEnabled")}
                              </FormLabel>
                              <FormDescription>
                                {t("hosts.statusCheckEnabledDesc")}
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

                      {form.watch("statsConfig.statusCheckEnabled") && (
                        <FormField
                          control={form.control}
                          name="statsConfig.statusCheckInterval"
                          render={({ field }) => {
                            const displayValue =
                              statusIntervalUnit === "minutes"
                                ? Math.round((field.value || 30) / 60)
                                : field.value || 30;

                            const handleIntervalChange = (value: string) => {
                              const numValue = parseInt(value) || 0;
                              const seconds =
                                statusIntervalUnit === "minutes"
                                  ? numValue * 60
                                  : numValue;
                              field.onChange(seconds);
                            };

                            return (
                              <FormItem>
                                <FormLabel>
                                  {t("hosts.statusCheckInterval")}
                                </FormLabel>
                                <div className="flex gap-2">
                                  <FormControl>
                                    <Input
                                      type="number"
                                      value={displayValue}
                                      onChange={(e) =>
                                        handleIntervalChange(e.target.value)
                                      }
                                      className="flex-1"
                                    />
                                  </FormControl>
                                  <Select
                                    value={statusIntervalUnit}
                                    onValueChange={(
                                      value: "seconds" | "minutes",
                                    ) => {
                                      setStatusIntervalUnit(value);
                                      const currentSeconds = field.value || 30;
                                      if (value === "minutes") {
                                        const minutes = Math.round(
                                          currentSeconds / 60,
                                        );
                                        field.onChange(minutes * 60);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-[120px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="seconds">
                                        {t("hosts.intervalSeconds")}
                                      </SelectItem>
                                      <SelectItem value="minutes">
                                        {t("hosts.intervalMinutes")}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <FormDescription>
                                  {t("hosts.statusCheckIntervalDesc")}
                                </FormDescription>
                              </FormItem>
                            );
                          }}
                        />
                      )}
                    </div>

                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="statsConfig.metricsEnabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                            <div className="space-y-0.5">
                              <FormLabel>{t("hosts.metricsEnabled")}</FormLabel>
                              <FormDescription>
                                {t("hosts.metricsEnabledDesc")}
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

                      {form.watch("statsConfig.metricsEnabled") && (
                        <FormField
                          control={form.control}
                          name="statsConfig.metricsInterval"
                          render={({ field }) => {
                            const displayValue =
                              metricsIntervalUnit === "minutes"
                                ? Math.round((field.value || 30) / 60)
                                : field.value || 30;

                            const handleIntervalChange = (value: string) => {
                              const numValue = parseInt(value) || 0;
                              const seconds =
                                metricsIntervalUnit === "minutes"
                                  ? numValue * 60
                                  : numValue;
                              field.onChange(seconds);
                            };

                            return (
                              <FormItem>
                                <FormLabel>
                                  {t("hosts.metricsInterval")}
                                </FormLabel>
                                <div className="flex gap-2">
                                  <FormControl>
                                    <Input
                                      type="number"
                                      value={displayValue}
                                      onChange={(e) =>
                                        handleIntervalChange(e.target.value)
                                      }
                                      className="flex-1"
                                    />
                                  </FormControl>
                                  <Select
                                    value={metricsIntervalUnit}
                                    onValueChange={(
                                      value: "seconds" | "minutes",
                                    ) => {
                                      setMetricsIntervalUnit(value);
                                      const currentSeconds = field.value || 30;
                                      if (value === "minutes") {
                                        const minutes = Math.round(
                                          currentSeconds / 60,
                                        );
                                        field.onChange(minutes * 60);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-[120px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="seconds">
                                        {t("hosts.intervalSeconds")}
                                      </SelectItem>
                                      <SelectItem value="minutes">
                                        {t("hosts.intervalMinutes")}
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <FormDescription>
                                  {t("hosts.metricsIntervalDesc")}
                                </FormDescription>
                              </FormItem>
                            );
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {form.watch("statsConfig.metricsEnabled") && (
                    <>
                      <FormField
                        control={form.control}
                        name="statsConfig.enabledWidgets"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("hosts.enabledWidgets")}</FormLabel>
                            <FormDescription>
                              {t("hosts.enabledWidgetsDesc")}
                            </FormDescription>
                            <div className="space-y-3 mt-3">
                              {(
                                [
                                  "cpu",
                                  "memory",
                                  "disk",
                                  "network",
                                  "uptime",
                                  "processes",
                                  "system",
                                  "login_stats",
                                  "ports",
                                ] as const
                              ).map((widget) => (
                                <div
                                  key={widget}
                                  className="flex items-center space-x-2"
                                >
                                  <Checkbox
                                    checked={field.value?.includes(widget)}
                                    onCheckedChange={(checked) => {
                                      const currentWidgets = field.value || [];
                                      if (checked) {
                                        field.onChange([
                                          ...currentWidgets,
                                          widget,
                                        ]);
                                      } else {
                                        field.onChange(
                                          currentWidgets.filter(
                                            (w) => w !== widget,
                                          ),
                                        );
                                      }
                                    }}
                                  />
                                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    {widget === "cpu" &&
                                      t("serverStats.cpuUsage")}
                                    {widget === "memory" &&
                                      t("serverStats.memoryUsage")}
                                    {widget === "disk" &&
                                      t("serverStats.diskUsage")}
                                    {widget === "network" &&
                                      t("serverStats.networkInterfaces")}
                                    {widget === "uptime" &&
                                      t("serverStats.uptime")}
                                    {widget === "processes" &&
                                      t("serverStats.processes")}
                                    {widget === "system" &&
                                      t("serverStats.systemInfo")}
                                    {widget === "login_stats" &&
                                      t("serverStats.loginStats")}
                                    {widget === "ports" &&
                                      t("serverStats.ports.title")}
                                  </label>
                                </div>
                              ))}
                            </div>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">
                      {t("hosts.quickActions")}
                    </h3>
                    <Alert>
                      <AlertDescription>
                        {t("hosts.quickActionsDescription")}
                      </AlertDescription>
                    </Alert>
                    <FormField
                      control={form.control}
                      name="quickActions"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("hosts.quickActionsList")}</FormLabel>
                          <FormControl>
                            <div className="space-y-3">
                              {field.value.map((quickAction, index) => (
                                <QuickActionItem
                                  key={index}
                                  quickAction={quickAction}
                                  index={index}
                                  snippets={snippets}
                                  onUpdate={(name, snippetId) => {
                                    const newQuickActions = [...field.value];
                                    newQuickActions[index] = {
                                      name,
                                      snippetId,
                                    };
                                    field.onChange(newQuickActions);
                                  }}
                                  onRemove={() => {
                                    const newQuickActions = field.value.filter(
                                      (_, i) => i !== index,
                                    );
                                    field.onChange(newQuickActions);
                                  }}
                                  t={t}
                                />
                              ))}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  field.onChange([
                                    ...field.value,
                                    { name: "", snippetId: 0 },
                                  ]);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                {t("hosts.addQuickAction")}
                              </Button>
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t("hosts.quickActionsOrder")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="sharing" className="space-y-6">
                  <HostSharingTab
                    hostId={editingHost?.id}
                    isNewHost={!editingHost?.id}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
          <footer className="shrink-0 w-full pb-0">
            <Separator className="p-0.25" />
            {!(editingHost?.permissionLevel === "view") && (
              <Button className="translate-y-2" type="submit" variant="outline">
                {editingHost
                  ? editingHost.id
                    ? t("hosts.updateHost")
                    : t("hosts.cloneHost")
                  : t("hosts.addHost")}
              </Button>
            )}
          </footer>
        </form>
      </Form>
    </div>
  );
}
