import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createCredential,
  updateCredential,
  getCredentials,
  getCredentialDetails,
  detectKeyType,
  detectPublicKeyType,
  generatePublicKeyFromPrivate,
  generateKeyPair,
} from "@/ui/main-axios";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import type {
  Credential,
  CredentialEditorProps,
  CredentialData,
} from "../../../../types/index.js";

export function CredentialEditor({
  editingCredential,
  onFormSubmit,
}: CredentialEditorProps) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullCredentialDetails, setFullCredentialDetails] =
    useState<Credential | null>(null);

  const [authTab, setAuthTab] = useState<"password" | "key">("password");
  const [detectedKeyType, setDetectedKeyType] = useState<string | null>(null);
  const [keyDetectionLoading, setKeyDetectionLoading] = useState(false);
  const keyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [detectedPublicKeyType, setDetectedPublicKeyType] = useState<
    string | null
  >(null);
  const [publicKeyDetectionLoading, setPublicKeyDetectionLoading] =
    useState(false);
  const publicKeyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const credentialsData = await getCredentials();
        setCredentials(credentialsData);

        const uniqueFolders = [
          ...new Set(
            credentialsData
              .filter(
                (credential) =>
                  credential.folder && credential.folder.trim() !== "",
              )
              .map((credential) => credential.folder!),
          ),
        ].sort() as string[];

        setFolders(uniqueFolders);
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    const fetchCredentialDetails = async () => {
      if (editingCredential) {
        try {
          const fullDetails = await getCredentialDetails(editingCredential.id);
          setFullCredentialDetails(fullDetails);
        } catch (error) {
          toast.error(t("credentials.failedToFetchCredentialDetails"));
        }
      } else {
        setFullCredentialDetails(null);
      }
    };

    fetchCredentialDetails();
  }, [editingCredential, t]);

  const formSchema = z
    .object({
      name: z.string().min(1),
      description: z.string().optional(),
      folder: z.string().optional(),
      tags: z.array(z.string().min(1)).default([]),
      authType: z.enum(["password", "key"]),
      username: z.string().min(1),
      password: z.string().optional(),
      key: z.any().optional().nullable(),
      publicKey: z.string().optional(),
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
    })
    .superRefine((data, ctx) => {
      if (data.authType === "password") {
        if (!data.password || data.password.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("credentials.passwordRequired"),
            path: ["password"],
          });
        }
      } else if (data.authType === "key") {
        if (!data.key && !editingCredential) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("credentials.sshKeyRequired"),
            path: ["key"],
          });
        }
      }
    });

  type FormData = z.infer<typeof formSchema>;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: "",
      description: "",
      folder: "",
      tags: [],
      authType: "password",
      username: "",
      password: "",
      key: null,
      publicKey: "",
      keyPassword: "",
      keyType: "auto",
    },
  });

  useEffect(() => {
    if (editingCredential && fullCredentialDetails) {
      const defaultAuthType = fullCredentialDetails.authType;
      setAuthTab(defaultAuthType);

      setTimeout(() => {
        const formData = {
          name: fullCredentialDetails.name || "",
          description: fullCredentialDetails.description || "",
          folder: fullCredentialDetails.folder || "",
          tags: fullCredentialDetails.tags || [],
          authType: defaultAuthType as "password" | "key",
          username: fullCredentialDetails.username || "",
          password: "",
          key: null,
          publicKey: "",
          keyPassword: "",
          keyType: "auto" as const,
        };

        if (defaultAuthType === "password") {
          formData.password = fullCredentialDetails.password || "";
        } else if (defaultAuthType === "key") {
          formData.key = fullCredentialDetails.key || "";
          formData.publicKey = fullCredentialDetails.publicKey || "";
          formData.keyPassword = fullCredentialDetails.keyPassword || "";
          formData.keyType =
            (fullCredentialDetails.keyType as any) || ("auto" as const);
        }

        form.reset(formData);
        setTagInput("");
      }, 100);
    } else if (!editingCredential) {
      setAuthTab("password");
      form.reset({
        name: "",
        description: "",
        folder: "",
        tags: [],
        authType: "password",
        username: "",
        password: "",
        key: null,
        publicKey: "",
        keyPassword: "",
        keyType: "auto",
      });
      setTagInput("");
    }
  }, [editingCredential?.id, fullCredentialDetails, form]);

  useEffect(() => {
    return () => {
      if (keyDetectionTimeoutRef.current) {
        clearTimeout(keyDetectionTimeoutRef.current);
      }
      if (publicKeyDetectionTimeoutRef.current) {
        clearTimeout(publicKeyDetectionTimeoutRef.current);
      }
    };
  }, []);

  const handleKeyTypeDetection = async (
    keyValue: string,
    keyPassword?: string,
  ) => {
    if (!keyValue || keyValue.trim() === "") {
      setDetectedKeyType(null);
      return;
    }

    setKeyDetectionLoading(true);
    try {
      const result = await detectKeyType(keyValue, keyPassword);
      if (result.success) {
        setDetectedKeyType(result.keyType);
      } else {
        setDetectedKeyType("invalid");
      }
    } catch (error) {
      setDetectedKeyType("error");
      console.error("Key type detection error:", error);
    } finally {
      setKeyDetectionLoading(false);
    }
  };

  const debouncedKeyDetection = (keyValue: string, keyPassword?: string) => {
    if (keyDetectionTimeoutRef.current) {
      clearTimeout(keyDetectionTimeoutRef.current);
    }
    keyDetectionTimeoutRef.current = setTimeout(() => {
      handleKeyTypeDetection(keyValue, keyPassword);
    }, 1000);
  };

  const handlePublicKeyTypeDetection = async (publicKeyValue: string) => {
    if (!publicKeyValue || publicKeyValue.trim() === "") {
      setDetectedPublicKeyType(null);
      return;
    }

    setPublicKeyDetectionLoading(true);
    try {
      const result = await detectPublicKeyType(publicKeyValue);
      if (result.success) {
        setDetectedPublicKeyType(result.keyType);
      } else {
        setDetectedPublicKeyType("invalid");
        console.warn("Public key detection failed:", result.error);
      }
    } catch (error) {
      setDetectedPublicKeyType("error");
      console.error("Public key type detection error:", error);
    } finally {
      setPublicKeyDetectionLoading(false);
    }
  };

  const debouncedPublicKeyDetection = (publicKeyValue: string) => {
    if (publicKeyDetectionTimeoutRef.current) {
      clearTimeout(publicKeyDetectionTimeoutRef.current);
    }
    publicKeyDetectionTimeoutRef.current = setTimeout(() => {
      handlePublicKeyTypeDetection(publicKeyValue);
    }, 1000);
  };

  const getFriendlyKeyTypeName = (keyType: string): string => {
    const keyTypeMap: Record<string, string> = {
      "ssh-rsa": "RSA (SSH)",
      "ssh-ed25519": "Ed25519 (SSH)",
      "ecdsa-sha2-nistp256": "ECDSA P-256 (SSH)",
      "ecdsa-sha2-nistp384": "ECDSA P-384 (SSH)",
      "ecdsa-sha2-nistp521": "ECDSA P-521 (SSH)",
      "ssh-dss": "DSA (SSH)",
      "rsa-sha2-256": "RSA-SHA2-256",
      "rsa-sha2-512": "RSA-SHA2-512",
      invalid: t("credentials.invalidKey"),
      error: t("credentials.detectionError"),
      unknown: t("credentials.unknown"),
    };
    return keyTypeMap[keyType] || keyType;
  };

  const onSubmit = async (data: FormData) => {
    try {
      if (!data.name || data.name.trim() === "") {
        data.name = data.username;
      }

      const submitData: CredentialData = {
        name: data.name,
        description: data.description,
        folder: data.folder,
        tags: data.tags,
        authType: data.authType,
        username: data.username,
        keyType: data.keyType,
      };

      submitData.password = null;
      submitData.key = null;
      submitData.publicKey = null;
      submitData.keyPassword = null;
      submitData.keyType = null;

      if (data.authType === "password") {
        submitData.password = data.password;
      } else if (data.authType === "key") {
        submitData.key = data.key;
        submitData.publicKey = data.publicKey;
        submitData.keyPassword = data.keyPassword;
        submitData.keyType = data.keyType;
      }

      if (editingCredential) {
        await updateCredential(editingCredential.id, submitData);
        toast.success(
          t("credentials.credentialUpdatedSuccessfully", { name: data.name }),
        );
      } else {
        await createCredential(submitData);
        toast.success(
          t("credentials.credentialAddedSuccessfully", { name: data.name }),
        );
      }

      if (onFormSubmit) {
        onFormSubmit();
      }

      window.dispatchEvent(new CustomEvent("credentials:changed"));

      form.reset();
    } catch (error) {
      console.error("Credential save error:", error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error(t("credentials.failedToSaveCredential"));
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

  return (
    <div
      className="flex-1 flex flex-col h-full min-h-0 w-full"
      key={editingCredential?.id || "new"}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col flex-1 min-h-0 h-full"
        >
          <ScrollArea className="flex-1 min-h-0 w-full my-1 pb-2">
            <Tabs defaultValue="general" className="w-full">
              <TabsList>
                <TabsTrigger value="general">
                  {t("credentials.general")}
                </TabsTrigger>
                <TabsTrigger value="authentication">
                  {t("credentials.authentication")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="general" className="pt-2">
                <FormLabel className="mb-2 font-bold">
                  {t("credentials.basicInformation")}
                </FormLabel>
                <div className="grid grid-cols-12 gap-3">
                  <FormField
                    control={form.control}
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
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem className="col-span-6">
                        <FormLabel>{t("credentials.username")}</FormLabel>
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
                <FormLabel className="mb-2 mt-4 font-bold">
                  {t("credentials.organization")}
                </FormLabel>
                <div className="grid grid-cols-26 gap-3">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-10">
                        <FormLabel>{t("credentials.description")}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t("placeholders.description")}
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
                        <FormLabel>{t("credentials.tags")}</FormLabel>
                        <FormControl>
                          <div className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-dark-bg-input focus-within:ring-2 ring-ring min-h-[40px]">
                            {(field.value || []).map(
                              (tag: string, idx: number) => (
                                <span
                                  key={`${tag}-${idx}`}
                                  className="flex items-center bg-gray-200 text-gray-800 rounded-full px-2 py-0.5 text-xs"
                                >
                                  {tag}
                                  <button
                                    type="button"
                                    className="ml-1 text-gray-500 hover:text-red-500 focus:outline-none"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const newTags = (
                                        field.value || []
                                      ).filter(
                                        (_: string, i: number) => i !== idx,
                                      );
                                      field.onChange(newTags);
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              ),
                            )}
                            <input
                              type="text"
                              className="flex-1 min-w-[60px] border-none outline-none bg-transparent p-0 h-6 text-sm"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === " " && tagInput.trim() !== "") {
                                  e.preventDefault();
                                  const currentTags = field.value || [];
                                  if (!currentTags.includes(tagInput.trim())) {
                                    field.onChange([
                                      ...currentTags,
                                      tagInput.trim(),
                                    ]);
                                  }
                                  setTagInput("");
                                } else if (
                                  e.key === "Enter" &&
                                  tagInput.trim() !== ""
                                ) {
                                  e.preventDefault();
                                  const currentTags = field.value || [];
                                  if (!currentTags.includes(tagInput.trim())) {
                                    field.onChange([
                                      ...currentTags,
                                      tagInput.trim(),
                                    ]);
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
              </TabsContent>
              <TabsContent value="authentication">
                <FormLabel className="mb-2 font-bold">
                  {t("credentials.authentication")}
                </FormLabel>
                <Tabs
                  value={authTab}
                  onValueChange={(value) => {
                    const newAuthType = value as "password" | "key";
                    setAuthTab(newAuthType);
                    form.setValue("authType", newAuthType);

                    form.setValue("password", "");
                    form.setValue("key", null);
                    form.setValue("keyPassword", "");
                    form.setValue("keyType", "auto");

                    if (newAuthType === "password") {
                    } else if (newAuthType === "key") {
                    }
                  }}
                  className="flex-1 flex flex-col h-full min-h-0"
                >
                  <TabsList>
                    <TabsTrigger value="password">
                      {t("credentials.password")}
                    </TabsTrigger>
                    <TabsTrigger value="key">
                      {t("credentials.key")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="password">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("credentials.password")}</FormLabel>
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
                    <div className="mt-2">
                      <div className="mb-3 p-3 bg-muted/20 border border-muted rounded-md">
                        <FormLabel className="mb-2 font-bold block">
                          {t("credentials.generateKeyPair")}
                        </FormLabel>

                        <div className="mb-2">
                          <div className="text-sm text-muted-foreground">
                            {t("credentials.generateKeyPairDescription")}
                          </div>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const currentKeyPassword =
                                  form.watch("keyPassword");
                                const result = await generateKeyPair(
                                  "ssh-ed25519",
                                  undefined,
                                  currentKeyPassword,
                                );

                                if (result.success) {
                                  form.setValue("key", result.privateKey);
                                  form.setValue("publicKey", result.publicKey);
                                  debouncedKeyDetection(
                                    result.privateKey,
                                    currentKeyPassword,
                                  );
                                  debouncedPublicKeyDetection(result.publicKey);
                                  toast.success(
                                    t(
                                      "credentials.keyPairGeneratedSuccessfully",
                                      { keyType: "Ed25519" },
                                    ),
                                  );
                                } else {
                                  toast.error(
                                    result.error ||
                                      t("credentials.failedToGenerateKeyPair"),
                                  );
                                }
                              } catch (error) {
                                console.error(
                                  "Failed to generate Ed25519 key pair:",
                                  error,
                                );
                                toast.error(
                                  t("credentials.failedToGenerateKeyPair"),
                                );
                              }
                            }}
                          >
                            {t("credentials.generateEd25519")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const currentKeyPassword =
                                  form.watch("keyPassword");
                                const result = await generateKeyPair(
                                  "ecdsa-sha2-nistp256",
                                  undefined,
                                  currentKeyPassword,
                                );

                                if (result.success) {
                                  form.setValue("key", result.privateKey);
                                  form.setValue("publicKey", result.publicKey);
                                  debouncedKeyDetection(
                                    result.privateKey,
                                    currentKeyPassword,
                                  );
                                  debouncedPublicKeyDetection(result.publicKey);
                                  toast.success(
                                    t(
                                      "credentials.keyPairGeneratedSuccessfully",
                                      { keyType: "ECDSA" },
                                    ),
                                  );
                                } else {
                                  toast.error(
                                    result.error ||
                                      t("credentials.failedToGenerateKeyPair"),
                                  );
                                }
                              } catch (error) {
                                console.error(
                                  "Failed to generate ECDSA key pair:",
                                  error,
                                );
                                toast.error(
                                  t("credentials.failedToGenerateKeyPair"),
                                );
                              }
                            }}
                          >
                            {t("credentials.generateECDSA")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const currentKeyPassword =
                                  form.watch("keyPassword");
                                const result = await generateKeyPair(
                                  "ssh-rsa",
                                  2048,
                                  currentKeyPassword,
                                );

                                if (result.success) {
                                  form.setValue("key", result.privateKey);
                                  form.setValue("publicKey", result.publicKey);
                                  debouncedKeyDetection(
                                    result.privateKey,
                                    currentKeyPassword,
                                  );
                                  debouncedPublicKeyDetection(result.publicKey);
                                  toast.success(
                                    t(
                                      "credentials.keyPairGeneratedSuccessfully",
                                      { keyType: "RSA" },
                                    ),
                                  );
                                } else {
                                  toast.error(
                                    result.error ||
                                      t("credentials.failedToGenerateKeyPair"),
                                  );
                                }
                              } catch (error) {
                                console.error(
                                  "Failed to generate RSA key pair:",
                                  error,
                                );
                                toast.error(
                                  t("credentials.failedToGenerateKeyPair"),
                                );
                              }
                            }}
                          >
                            {t("credentials.generateRSA")}
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 items-start">
                        <Controller
                          control={form.control}
                          name="key"
                          render={({ field }) => (
                            <FormItem className="mb-3 flex flex-col">
                              <FormLabel className="mb-1 min-h-[20px]">
                                {t("credentials.sshPrivateKey")}
                              </FormLabel>
                              <div className="mb-1">
                                <div className="relative inline-block w-full">
                                  <input
                                    id="key-upload"
                                    type="file"
                                    accept="*,.pem,.key,.txt,.ppk"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        try {
                                          const fileContent = await file.text();
                                          field.onChange(fileContent);
                                          debouncedKeyDetection(
                                            fileContent,
                                            form.watch("keyPassword"),
                                          );
                                        } catch (error) {
                                          console.error(
                                            "Failed to read uploaded file:",
                                            error,
                                          );
                                        }
                                      }
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-start text-left"
                                  >
                                    <span className="truncate">
                                      {t("credentials.uploadPrivateKeyFile")}
                                    </span>
                                  </Button>
                                </div>
                              </div>
                              <FormControl>
                                <CodeMirror
                                  value={
                                    typeof field.value === "string"
                                      ? field.value
                                      : ""
                                  }
                                  onChange={(value) => {
                                    field.onChange(value);
                                    debouncedKeyDetection(
                                      value,
                                      form.watch("keyPassword"),
                                    );
                                  }}
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
                              {detectedKeyType && (
                                <div className="text-sm mt-2">
                                  <span className="text-muted-foreground">
                                    {t("credentials.detectedKeyType")}:{" "}
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      detectedKeyType === "invalid" ||
                                      detectedKeyType === "error"
                                        ? "text-destructive"
                                        : "text-green-600"
                                    }`}
                                  >
                                    {getFriendlyKeyTypeName(detectedKeyType)}
                                  </span>
                                  {keyDetectionLoading && (
                                    <span className="ml-2 text-muted-foreground">
                                      ({t("credentials.detectingKeyType")})
                                    </span>
                                  )}
                                </div>
                              )}
                            </FormItem>
                          )}
                        />
                        <Controller
                          control={form.control}
                          name="publicKey"
                          render={({ field }) => (
                            <FormItem className="mb-3 flex flex-col">
                              <FormLabel className="mb-1 min-h-[20px]">
                                {t("credentials.sshPublicKey")}
                              </FormLabel>
                              <div className="mb-1 flex gap-2">
                                <div className="relative inline-block flex-1">
                                  <input
                                    id="public-key-upload"
                                    type="file"
                                    accept="*,.pub,.txt"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        try {
                                          const fileContent = await file.text();
                                          field.onChange(fileContent);
                                          debouncedPublicKeyDetection(
                                            fileContent,
                                          );
                                        } catch (error) {
                                          console.error(
                                            "Failed to read uploaded public key file:",
                                            error,
                                          );
                                        }
                                      }
                                    }}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-start text-left"
                                  >
                                    <span className="truncate">
                                      {t("credentials.uploadPublicKeyFile")}
                                    </span>
                                  </Button>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="flex-shrink-0"
                                  onClick={async () => {
                                    const privateKey = form.watch("key");
                                    if (
                                      !privateKey ||
                                      typeof privateKey !== "string" ||
                                      !privateKey.trim()
                                    ) {
                                      toast.error(
                                        t(
                                          "credentials.privateKeyRequiredForGeneration",
                                        ),
                                      );
                                      return;
                                    }

                                    try {
                                      const keyPassword =
                                        form.watch("keyPassword");
                                      const result =
                                        await generatePublicKeyFromPrivate(
                                          privateKey,
                                          keyPassword,
                                        );

                                      if (result.success && result.publicKey) {
                                        field.onChange(result.publicKey);
                                        debouncedPublicKeyDetection(
                                          result.publicKey,
                                        );

                                        toast.success(
                                          t(
                                            "credentials.publicKeyGeneratedSuccessfully",
                                          ),
                                        );
                                      } else {
                                        toast.error(
                                          result.error ||
                                            t(
                                              "credentials.failedToGeneratePublicKey",
                                            ),
                                        );
                                      }
                                    } catch (error) {
                                      console.error(
                                        "Failed to generate public key:",
                                        error,
                                      );
                                      toast.error(
                                        t(
                                          "credentials.failedToGeneratePublicKey",
                                        ),
                                      );
                                    }
                                  }}
                                >
                                  {t("credentials.generatePublicKey")}
                                </Button>
                              </div>
                              <FormControl>
                                <CodeMirror
                                  value={field.value || ""}
                                  onChange={(value) => {
                                    field.onChange(value);
                                    debouncedPublicKeyDetection(value);
                                  }}
                                  placeholder={t("placeholders.pastePublicKey")}
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
                              {detectedPublicKeyType && field.value && (
                                <div className="text-sm mt-2">
                                  <span className="text-muted-foreground">
                                    {t("credentials.detectedKeyType")}:{" "}
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      detectedPublicKeyType === "invalid" ||
                                      detectedPublicKeyType === "error"
                                        ? "text-destructive"
                                        : "text-green-600"
                                    }`}
                                  >
                                    {getFriendlyKeyTypeName(
                                      detectedPublicKeyType,
                                    )}
                                  </span>
                                  {publicKeyDetectionLoading && (
                                    <span className="ml-2 text-muted-foreground">
                                      ({t("credentials.detectingKeyType")})
                                    </span>
                                  )}
                                </div>
                              )}
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-8 gap-3 mt-3">
                        <FormField
                          control={form.control}
                          name="keyPassword"
                          render={({ field }) => (
                            <FormItem className="col-span-8">
                              <FormLabel>
                                {t("credentials.keyPassword")}
                              </FormLabel>
                              <FormControl>
                                <PasswordInput
                                  placeholder={t("placeholders.keyPassword")}
                                  {...field}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </TabsContent>
            </Tabs>
          </ScrollArea>
          <footer className="shrink-0 w-full pb-0">
            <Separator className="p-0.25" />
            <Button className="translate-y-2" type="submit" variant="outline">
              {editingCredential
                ? t("credentials.updateCredential")
                : t("credentials.addCredential")}
            </Button>
          </footer>
        </form>
      </Form>
    </div>
  );
}
