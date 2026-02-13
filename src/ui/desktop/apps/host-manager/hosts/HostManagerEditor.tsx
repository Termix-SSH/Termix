import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { cn } from "@/lib/utils.ts";

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
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  createSSHHost,
  getCredentials,
  getSSHHosts,
  updateSSHHost,
  enableAutoStart,
  disableAutoStart,
  getSnippets,
  getRoles,
  getUserList,
  getUserInfo,
  shareHost,
  getHostAccess,
  revokeHostAccess,
  getSSHHostById,
  notifyHostCreatedOrUpdated,
  type Role,
  type AccessRecord,
} from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { CredentialSelector } from "@/ui/desktop/apps/host-manager/credentials/CredentialSelector.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { githubLight } from "@uiw/codemirror-theme-github";
import { EditorView } from "@codemirror/view";
import { useTheme } from "@/components/theme-provider.tsx";
import type { StatsConfig } from "@/types/stats-widgets.ts";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets.ts";
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
} from "@/constants/terminal-themes.ts";
import { TerminalPreview } from "@/ui/desktop/apps/features/terminal/TerminalPreview.tsx";
import type { TerminalConfig, SSHHost, Credential } from "@/types";
import {
  Plus,
  X,
  Check,
  ChevronsUpDown,
  Save,
  AlertCircle,
  Trash2,
  Users,
  Shield,
  Clock,
  UserCircle,
  ArrowLeft,
} from "lucide-react";
import { HostGeneralTab } from "./tabs/HostGeneralTab";
import { HostTerminalTab } from "./tabs/HostTerminalTab";
import { HostDockerTab } from "./tabs/HostDockerTab";
import { HostTunnelTab } from "./tabs/HostTunnelTab";
import { HostFileManagerTab } from "./tabs/HostFileManagerTab";
import { HostStatisticsTab } from "./tabs/HostStatisticsTab";
import { HostSharingTab } from "./tabs/HostSharingTab";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

interface User {
  id: string;
  username: string;
  is_admin: boolean;
}

interface SSHManagerHostEditorProps {
  editingHost?: SSHHost | null;
  onFormSubmit?: (updatedHost?: SSHHost) => void;
  onBack?: () => void;
}

export function HostManagerEditor({
  editingHost,
  onFormSubmit,
  onBack,
}: SSHManagerHostEditorProps) {
  const { t } = useTranslation();
  const { theme: appTheme } = useTheme();

  const isDarkMode =
    appTheme === "dark" ||
    (appTheme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorTheme = isDarkMode ? oneDark : githubLight;
  const [folders, setFolders] = useState<string[]>([]);
  const [sshConfigurations, setSshConfigurations] = useState<string[]>([]);
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [snippets, setSnippets] = useState<
    Array<{ id: number; name: string; content: string }>
  >([]);
  const [proxyMode, setProxyMode] = useState<"single" | "chain">("single");

  const [authTab, setAuthTab] = useState<
    "password" | "key" | "credential" | "none" | "opkssh"
  >("password");
  const [keyInputMethod, setKeyInputMethod] = useState<"upload" | "paste">(
    "upload",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      authType: z.enum(["password", "key", "credential", "none", "opkssh"]),
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
            tunnelType: z
              .enum(["local", "remote"])
              .default("remote")
              .optional(),
            sourcePort: z.coerce.number().min(1).max(65535),
            endpointPort: z.coerce.number().min(1).max(65535),
            endpointHost: z.string().min(1),
            endpointPassword: z.string().optional(),
            endpointKey: z.string().optional(),
            endpointKeyPassword: z.string().optional(),
            endpointAuthType: z.string().optional(),
            endpointKeyType: z.string().optional(),
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
                "firewall",
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
              "ports",
              "firewall",
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
            "ports",
            "firewall",
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
      showTerminalInSidebar: z.boolean().default(true),
      showFileManagerInSidebar: z.boolean().default(false),
      showTunnelInSidebar: z.boolean().default(false),
      showDockerInSidebar: z.boolean().default(false),
      showServerStatsInSidebar: z.boolean().default(false),
    })
    .superRefine((data, ctx) => {
      if (data.authType === "none") {
        return;
      }

      if (data.authType === "opkssh") {
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
    mode: "all",
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
      showTerminalInSidebar: true,
      showFileManagerInSidebar: false,
      showTunnelInSidebar: false,
      showDockerInSidebar: false,
      showServerStatsInSidebar: false,
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

  const watchedFields = form.watch();
  const formState = form.formState;

  const isFormValid = React.useMemo(() => {
    const values = form.getValues();

    if (!values.ip || !values.username || values.username.trim() === "")
      return false;

    if (authTab === "password") {
      return !!(values.password && values.password.trim() !== "");
    } else if (authTab === "key") {
      return !!(values.key && values.keyType);
    } else if (authTab === "credential") {
      return !!values.credentialId;
    } else if (authTab === "none") {
      return true;
    } else if (authTab === "opkssh") {
      return true;
    }

    return false;
  }, [watchedFields, authTab]);

  useEffect(() => {
    const updateAuthFields = async () => {
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

        const currentCredentialId = form.getValues("credentialId");
        const overrideUsername = form.getValues("overrideCredentialUsername");
        if (currentCredentialId && !overrideUsername) {
          const selectedCredential = credentials.find(
            (c) => c.id === currentCredentialId,
          );
          if (selectedCredential?.username) {
            form.setValue("username", selectedCredential.username, {
              shouldValidate: true,
            });
          }
        }
      } else if (authTab === "none") {
        form.setValue("password", "", { shouldValidate: true });
        form.setValue("key", null, { shouldValidate: true });
        form.setValue("keyPassword", "", { shouldValidate: true });
        form.setValue("keyType", "auto", { shouldValidate: true });
        form.setValue("credentialId", null, { shouldValidate: true });
      } else if (authTab === "opkssh") {
        form.setValue("password", "", { shouldValidate: true });
        form.setValue("key", null, { shouldValidate: true });
        form.setValue("keyPassword", "", { shouldValidate: true });
        form.setValue("keyType", "auto", { shouldValidate: true });
        form.setValue("credentialId", null, { shouldValidate: true });
      }

      await form.trigger();
    };

    updateAuthFields();
  }, [authTab, credentials]);

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

      const defaultAuthType = (cleanedHost.authType ||
        (cleanedHost.credentialId
          ? "credential"
          : cleanedHost.key
            ? "key"
            : cleanedHost.password
              ? "password"
              : "none")) as
        | "password"
        | "key"
        | "credential"
        | "none"
        | "opkssh";

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
        authType: defaultAuthType as
          | "password"
          | "key"
          | "credential"
          | "none"
          | "opkssh",
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
          ? cleanedHost.tunnelConnections.map((conn: any) => ({
              ...conn,
              tunnelType: conn.tunnelType || "remote",
            }))
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
          sudoPassword:
            cleanedHost.sudoPassword ||
            cleanedHost.terminalConfig?.sudoPassword ||
            "",
          sudoPasswordAutoFill:
            cleanedHost.terminalConfig?.sudoPasswordAutoFill ??
            Boolean(cleanedHost.sudoPassword),
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
        showTerminalInSidebar: cleanedHost.showTerminalInSidebar ?? true,
        showFileManagerInSidebar: cleanedHost.showFileManagerInSidebar ?? false,
        showTunnelInSidebar: cleanedHost.showTunnelInSidebar ?? false,
        showDockerInSidebar: cleanedHost.showDockerInSidebar ?? false,
        showServerStatsInSidebar: cleanedHost.showServerStatsInSidebar ?? false,
      };

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
        showTerminalInSidebar: true,
        showFileManagerInSidebar: false,
        showTunnelInSidebar: false,
        showDockerInSidebar: false,
        showServerStatsInSidebar: false,
      };

      form.reset(defaultFormData as FormData);
    }
  }, [editingHost]);

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
      setIsSubmitting(true);
      setFormError(null);

      if (!data.name || data.name.trim() === "") {
        data.name = `${data.username}@${data.ip}`;
      }

      const submitData: Partial<SSHHost> = {
        ...data,
      };

      if (
        data.terminalConfig?.sudoPasswordAutoFill &&
        data.terminalConfig?.sudoPassword
      ) {
        submitData.sudoPassword = data.terminalConfig.sudoPassword;
      }

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
        notifyHostCreatedOrUpdated(savedHost.id);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(t("hosts.failedToSaveHost") + ": " + errorMessage);
      console.error("Failed to save host:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const TAB_PRIORITY = [
    "general",
    "terminal",
    "tunnel",
    "file_manager",
    "docker",
    "statistics",
  ] as const;

  const FIELD_TO_TAB_MAP: Record<string, string> = {
    ip: "general",
    port: "general",
    username: "general",
    name: "general",
    folder: "general",
    tags: "general",
    pin: "general",
    password: "general",
    key: "general",
    keyPassword: "general",
    keyType: "general",
    credentialId: "general",
    overrideCredentialUsername: "general",
    forceKeyboardInteractive: "general",
    jumpHosts: "general",
    authType: "general",
    notes: "general",
    useSocks5: "general",
    socks5Host: "general",
    socks5Port: "general",
    socks5Username: "general",
    socks5Password: "general",
    socks5ProxyChain: "general",
    quickActions: "general",
    enableTerminal: "terminal",
    terminalConfig: "terminal",
    enableDocker: "docker",
    enableTunnel: "tunnel",
    tunnelConnections: "tunnel",
    enableFileManager: "file_manager",
    defaultPath: "file_manager",
    statsConfig: "statistics",
  };

  const handleFormError = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));

    const errors = form.formState.errors;
    const errorFields = Object.keys(errors);

    if (errorFields.length === 0) return;

    for (const tab of TAB_PRIORITY) {
      const hasErrorInTab = errorFields.some((field) => {
        const baseField = field.split(".")[0].split("[")[0];
        return FIELD_TO_TAB_MAP[baseField] === tab;
      });

      if (hasErrorInTab) {
        setActiveTab(tab);
        return;
      }
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
    <div className="flex-1 flex flex-col h-full min-h-0 w-full relative">
      <SimpleLoader
        visible={isSubmitting}
        message={
          editingHost?.id
            ? t("hosts.updatingHost")
            : editingHost
              ? t("hosts.cloningHost")
              : t("hosts.savingHost")
        }
        backgroundColor="var(--bg-base)"
      />
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
              <div className="flex items-center gap-2 mb-3">
                {onBack && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onBack}
                    className="flex-shrink-0"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    {t("common.back")}
                  </Button>
                )}
                <h3 className="text-lg font-semibold flex-shrink-0">
                  {editingHost
                    ? editingHost.id
                      ? t("hosts.editHost")
                      : t("hosts.cloneHost")
                    : t("hosts.addHost")}
                </h3>
              </div>
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="w-full"
              >
                <TabsList className="bg-button border border-edge-medium">
                  <TabsTrigger
                    value="general"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    {t("hosts.general")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="terminal"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    {t("hosts.terminal")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="docker"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    Docker
                  </TabsTrigger>
                  <TabsTrigger
                    value="tunnel"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    {t("hosts.tunnel")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="file_manager"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    {t("hosts.fileManager")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="statistics"
                    className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                  >
                    {t("hosts.statistics")}
                  </TabsTrigger>
                  {!editingHost?.isShared && (
                    <TabsTrigger value="sharing">
                      {t("rbac.sharing")}
                    </TabsTrigger>
                  )}
                </TabsList>
                <TabsContent value="general" className="pt-2">
                  <HostGeneralTab
                    form={form}
                    authTab={authTab}
                    setAuthTab={setAuthTab}
                    keyInputMethod={keyInputMethod}
                    setKeyInputMethod={setKeyInputMethod}
                    proxyMode={proxyMode}
                    setProxyMode={setProxyMode}
                    tagInput={tagInput}
                    setTagInput={setTagInput}
                    folderDropdownOpen={folderDropdownOpen}
                    setFolderDropdownOpen={setFolderDropdownOpen}
                    folderInputRef={folderInputRef}
                    folderDropdownRef={folderDropdownRef}
                    filteredFolders={filteredFolders}
                    handleFolderClick={handleFolderClick}
                    keyTypeDropdownOpen={keyTypeDropdownOpen}
                    setKeyTypeDropdownOpen={setKeyTypeDropdownOpen}
                    keyTypeButtonRef={keyTypeButtonRef}
                    keyTypeDropdownRef={keyTypeDropdownRef}
                    keyTypeOptions={keyTypeOptions}
                    ipInputRef={ipInputRef}
                    editorTheme={editorTheme}
                    hosts={hosts}
                    editingHost={editingHost}
                    folders={folders}
                    credentials={credentials}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="terminal" className="space-y-1">
                  <HostTerminalTab form={form} snippets={snippets} t={t} />
                </TabsContent>
                <TabsContent value="docker" className="space-y-4">
                  <HostDockerTab form={form} t={t} />
                </TabsContent>
                <TabsContent value="tunnel">
                  <HostTunnelTab
                    form={form}
                    sshConfigDropdownOpen={sshConfigDropdownOpen}
                    setSshConfigDropdownOpen={setSshConfigDropdownOpen}
                    sshConfigInputRefs={sshConfigInputRefs}
                    sshConfigDropdownRefs={sshConfigDropdownRefs}
                    getFilteredSshConfigs={getFilteredSshConfigs}
                    handleSshConfigClick={handleSshConfigClick}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="file_manager">
                  <HostFileManagerTab form={form} t={t} />
                </TabsContent>
                <TabsContent value="statistics" className="space-y-6">
                  <HostStatisticsTab
                    form={form}
                    statusIntervalUnit={statusIntervalUnit}
                    setStatusIntervalUnit={setStatusIntervalUnit}
                    metricsIntervalUnit={metricsIntervalUnit}
                    setMetricsIntervalUnit={setMetricsIntervalUnit}
                    snippets={snippets}
                    t={t}
                  />
                </TabsContent>
                <TabsContent value="sharing" className="space-y-6">
                  <HostSharingTab
                    hostId={editingHost?.id}
                    isNewHost={!editingHost}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
          <footer className="shrink-0 w-full pb-0">
            <Separator className="p-0.25" />
            {!editingHost?.isShared && !isSubmitting && (
              <Button
                className="translate-y-2"
                type="submit"
                variant="outline"
                disabled={!isFormValid}
              >
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
