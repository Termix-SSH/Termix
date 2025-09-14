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
  validateKeyPair,
} from "@/ui/main-axios";
import { useTranslation } from "react-i18next";
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
  const [keyInputMethod, setKeyInputMethod] = useState<"upload" | "paste">(
    "upload",
  );
  const [detectedKeyType, setDetectedKeyType] = useState<string | null>(null);
  const [keyDetectionLoading, setKeyDetectionLoading] = useState(false);
  const keyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [detectedPublicKeyType, setDetectedPublicKeyType] = useState<string | null>(null);
  const [publicKeyDetectionLoading, setPublicKeyDetectionLoading] = useState(false);
  const publicKeyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [keyPairValidation, setKeyPairValidation] = useState<{
    isValid: boolean | null;
    loading: boolean;
    error?: string;
  }>({ isValid: null, loading: false });
  const keyPairValidationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (keyDetectionTimeoutRef.current) {
        clearTimeout(keyDetectionTimeoutRef.current);
      }
      if (publicKeyDetectionTimeoutRef.current) {
        clearTimeout(publicKeyDetectionTimeoutRef.current);
      }
      if (keyPairValidationTimeoutRef.current) {
        clearTimeout(keyPairValidationTimeoutRef.current);
      }
    };
  }, []);

  // Detect key type function
  const handleKeyTypeDetection = async (keyValue: string, keyPassword?: string) => {
    if (!keyValue || keyValue.trim() === '') {
      setDetectedKeyType(null);
      return;
    }

    setKeyDetectionLoading(true);
    try {
      const result = await detectKeyType(keyValue, keyPassword);
      if (result.success) {
        setDetectedKeyType(result.keyType);
      } else {
        setDetectedKeyType('invalid');
        console.warn('Key detection failed:', result.error);
      }
    } catch (error) {
      setDetectedKeyType('error');
      console.error('Key type detection error:', error);
    } finally {
      setKeyDetectionLoading(false);
    }
  };

  // Debounced key type detection
  const debouncedKeyDetection = (keyValue: string, keyPassword?: string) => {
    if (keyDetectionTimeoutRef.current) {
      clearTimeout(keyDetectionTimeoutRef.current);
    }
    keyDetectionTimeoutRef.current = setTimeout(() => {
      handleKeyTypeDetection(keyValue, keyPassword);
    }, 1000);
  };

  // Detect public key type function
  const handlePublicKeyTypeDetection = async (publicKeyValue: string) => {
    if (!publicKeyValue || publicKeyValue.trim() === '') {
      setDetectedPublicKeyType(null);
      return;
    }

    setPublicKeyDetectionLoading(true);
    try {
      const result = await detectPublicKeyType(publicKeyValue);
      if (result.success) {
        setDetectedPublicKeyType(result.keyType);
      } else {
        setDetectedPublicKeyType('invalid');
        console.warn('Public key detection failed:', result.error);
      }
    } catch (error) {
      setDetectedPublicKeyType('error');
      console.error('Public key type detection error:', error);
    } finally {
      setPublicKeyDetectionLoading(false);
    }
  };

  // Debounced public key type detection
  const debouncedPublicKeyDetection = (publicKeyValue: string) => {
    if (publicKeyDetectionTimeoutRef.current) {
      clearTimeout(publicKeyDetectionTimeoutRef.current);
    }
    publicKeyDetectionTimeoutRef.current = setTimeout(() => {
      handlePublicKeyTypeDetection(publicKeyValue);
    }, 1000);
  };

  // Validate key pair function
  const handleKeyPairValidation = async (privateKeyValue: string, publicKeyValue: string, keyPassword?: string) => {
    if (!privateKeyValue || privateKeyValue.trim() === '' || !publicKeyValue || publicKeyValue.trim() === '') {
      setKeyPairValidation({ isValid: null, loading: false });
      return;
    }

    setKeyPairValidation({ isValid: null, loading: true });
    try {
      const result = await validateKeyPair(privateKeyValue, publicKeyValue, keyPassword);
      setKeyPairValidation({
        isValid: result.isValid,
        loading: false,
        error: result.error
      });
    } catch (error) {
      setKeyPairValidation({
        isValid: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error during validation'
      });
    }
  };

  // Debounced key pair validation
  const debouncedKeyPairValidation = (privateKeyValue: string, publicKeyValue: string, keyPassword?: string) => {
    if (keyPairValidationTimeoutRef.current) {
      clearTimeout(keyPairValidationTimeoutRef.current);
    }
    keyPairValidationTimeoutRef.current = setTimeout(() => {
      handleKeyPairValidation(privateKeyValue, publicKeyValue, keyPassword);
    }, 1500); // Slightly longer delay since this is more expensive
  };

  const getFriendlyKeyTypeName = (keyType: string): string => {
    const keyTypeMap: Record<string, string> = {
      'ssh-rsa': 'RSA',
      'ssh-ed25519': 'Ed25519',
      'ecdsa-sha2-nistp256': 'ECDSA P-256',
      'ecdsa-sha2-nistp384': 'ECDSA P-384',
      'ecdsa-sha2-nistp521': 'ECDSA P-521',
      'ssh-dss': 'DSA',
      'rsa-sha2-256': 'RSA-SHA2-256',
      'rsa-sha2-512': 'RSA-SHA2-512',
      'invalid': 'Invalid Key',
      'error': 'Detection Error',
      'unknown': 'Unknown'
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
        if (data.key instanceof File) {
          const keyContent = await data.key.text();
          submitData.key = keyContent;
        } else {
          submitData.key = data.key;
        }
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
                <FormLabel className="mb-3 font-bold">
                  {t("credentials.basicInformation")}
                </FormLabel>
                <div className="grid grid-cols-12 gap-4">
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
                <FormLabel className="mb-3 mt-3 font-bold">
                  {t("credentials.organization")}
                </FormLabel>
                <div className="grid grid-cols-26 gap-4">
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
                <FormLabel className="mb-3 font-bold">
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
                    <Tabs
                      value={keyInputMethod}
                      onValueChange={(value) => {
                        setKeyInputMethod(value as "upload" | "paste");
                        // Only reset key value if we're not editing an existing credential
                        if (!editingCredential) {
                          if (value === "upload") {
                            form.setValue("key", null);
                            form.setValue("publicKey", "");
                          } else if (value === "paste") {
                            form.setValue("key", "");
                            form.setValue("publicKey", "");
                          }
                        } else {
                          // For existing credentials, preserve the key data when switching methods
                          const currentKey = fullCredentialDetails?.key || "";
                          const currentPublicKey = fullCredentialDetails?.publicKey || "";
                          if (value === "paste") {
                            form.setValue("key", currentKey);
                            form.setValue("publicKey", currentPublicKey);
                          } else {
                            // For upload mode, keep the current string value to show "existing key" status
                            form.setValue("key", currentKey);
                            form.setValue("publicKey", currentPublicKey);
                          }
                        }
                      }}
                      className="w-full"
                    >
                      <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                        <TabsTrigger value="upload">
                          {t("hosts.uploadFile")}
                        </TabsTrigger>
                        <TabsTrigger value="paste">
                          {t("hosts.pasteKey")}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="upload" className="mt-4">
                        <div className="grid grid-cols-2 gap-4 items-start">
                          <Controller
                            control={form.control}
                            name="key"
                            render={({ field }) => (
                              <FormItem className="mb-4 flex flex-col">
                                <FormLabel className="mb-2 min-h-[20px]">
                                  {t("credentials.sshPrivateKey")}
                                </FormLabel>
                                <FormControl>
                                  <div className="relative inline-block w-full">
                                    <input
                                      id="key-upload"
                                      type="file"
                                      accept="*,.pem,.key,.txt,.ppk"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        field.onChange(file || null);

                                        // Detect key type from uploaded file
                                        if (file) {
                                          try {
                                            const fileContent = await file.text();
                                            debouncedKeyDetection(fileContent, form.watch("keyPassword"));
                                            // Trigger key pair validation if public key is available
                                            const publicKeyValue = form.watch("publicKey");
                                            if (publicKeyValue && publicKeyValue.trim()) {
                                              debouncedKeyPairValidation(fileContent, publicKeyValue, form.watch("keyPassword"));
                                            }
                                          } catch (error) {
                                            console.error('Failed to read uploaded file:', error);
                                          }
                                        } else {
                                          setDetectedKeyType(null);
                                        }
                                      }}
                                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="w-full justify-start text-left"
                                    >
                                      <span
                                        className="truncate"
                                        title={
                                          field.value?.name ||
                                          t("credentials.upload")
                                        }
                                      >
                                        {field.value instanceof File
                                          ? field.value.name
                                          : typeof field.value === "string" && field.value && editingCredential
                                            ? t("hosts.existingKey") + " - " + t("credentials.updateKey")
                                            : field.value
                                              ? t("credentials.updateKey")
                                              : t("credentials.upload")}
                                      </span>
                                    </Button>
                                  </div>
                                </FormControl>
                                {/* Key type detection display for uploaded files */}
                                {detectedKeyType && field.value instanceof File && (
                                  <div className="text-sm mt-2">
                                    <span className="text-muted-foreground">Detected key type: </span>
                                    <span className={`font-medium ${
                                      detectedKeyType === 'invalid' || detectedKeyType === 'error'
                                        ? 'text-destructive'
                                        : 'text-green-600'
                                    }`}>
                                      {getFriendlyKeyTypeName(detectedKeyType)}
                                    </span>
                                    {keyDetectionLoading && (
                                      <span className="ml-2 text-muted-foreground">(detecting...)</span>
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
                              <FormItem className="mb-4 flex flex-col">
                                <FormLabel className="mb-2 min-h-[20px]">
                                  {t("credentials.sshPublicKey")} ({t("credentials.optional")})
                                </FormLabel>
                                <FormControl>
                                  <div className="relative inline-block w-full">
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
                                            // Detect public key type from uploaded file
                                            debouncedPublicKeyDetection(fileContent);
                                            // Trigger key pair validation if private key is available
                                            const privateKeyValue = form.watch("key");
                                            if (privateKeyValue && typeof privateKeyValue === "string" && privateKeyValue.trim()) {
                                              debouncedKeyPairValidation(privateKeyValue, fileContent, form.watch("keyPassword"));
                                            }
                                          } catch (error) {
                                            console.error('Failed to read uploaded public key file:', error);
                                          }
                                        } else {
                                          field.onChange("");
                                          setDetectedPublicKeyType(null);
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
                                        {field.value
                                          ? t("credentials.publicKeyUploaded")
                                          : t("credentials.uploadPublicKey")}
                                      </span>
                                    </Button>
                                  </div>
                                </FormControl>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t("credentials.publicKeyNote")}
                                </div>
                                {/* Public key type detection display for upload mode */}
                                {detectedPublicKeyType && field.value && (
                                  <div className="text-sm mt-2">
                                    <span className="text-muted-foreground">Detected key type: </span>
                                    <span className={`font-medium ${
                                      detectedPublicKeyType === 'invalid' || detectedPublicKeyType === 'error'
                                        ? 'text-destructive'
                                        : 'text-green-600'
                                    }`}>
                                      {getFriendlyKeyTypeName(detectedPublicKeyType)}
                                    </span>
                                    {publicKeyDetectionLoading && (
                                      <span className="ml-2 text-muted-foreground">(detecting...)</span>
                                    )}
                                  </div>
                                )}
                              </FormItem>
                            )}
                          />
                        </div>
                        {/* Show existing key content preview for upload mode */}
                        {editingCredential && fullCredentialDetails?.key && typeof form.watch("key") === "string" && (
                          <FormItem className="mb-4">
                            <FormLabel>{t("credentials.sshPrivateKey")} ({t("hosts.existingKey")})</FormLabel>
                            <FormControl>
                              <textarea
                                readOnly
                                className="flex min-h-[120px] w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={fullCredentialDetails.key}
                              />
                            </FormControl>
                            <div className="text-xs text-muted-foreground mt-1">
                              Current SSH key content - {t("credentials.uploadFile")} to replace
                            </div>
                            {/* Show detected key type for existing credential */}
                            {fullCredentialDetails?.detectedKeyType && (
                              <div className="text-sm mt-2">
                                <span className="text-muted-foreground">Key type: </span>
                                <span className="font-medium text-green-600">
                                  {getFriendlyKeyTypeName(fullCredentialDetails.detectedKeyType)}
                                </span>
                              </div>
                            )}
                          </FormItem>
                        )}
                        <div className="grid grid-cols-15 gap-4 mt-4">
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
                          <FormField
                            control={form.control}
                            name="keyType"
                            render={({ field }) => (
                              <FormItem className="relative col-span-3">
                                <FormLabel>
                                  {t("credentials.keyType")}
                                </FormLabel>
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
                                      )?.label || t("credentials.keyTypeRSA")}
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
                      <TabsContent value="paste" className="mt-4">
                        <div className="grid grid-cols-2 gap-4 items-start">
                          <Controller
                            control={form.control}
                            name="key"
                            render={({ field }) => (
                              <FormItem className="mb-4 flex flex-col">
                                <FormLabel className="mb-2 min-h-[20px]">
                                  {t("credentials.sshPrivateKey")}
                                </FormLabel>
                                <FormControl>
                                  <textarea
                                    placeholder={t(
                                      "placeholders.pastePrivateKey",
                                    )}
                                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={
                                      typeof field.value === "string"
                                        ? field.value
                                        : ""
                                    }
                                    onChange={(e) => {
                                      field.onChange(e.target.value);
                                      // Trigger key type detection with debounce
                                      debouncedKeyDetection(e.target.value, form.watch("keyPassword"));
                                      // Trigger key pair validation if public key is available
                                      const publicKeyValue = form.watch("publicKey");
                                      if (publicKeyValue && publicKeyValue.trim()) {
                                        debouncedKeyPairValidation(e.target.value, publicKeyValue, form.watch("keyPassword"));
                                      }
                                    }}
                                  />
                                </FormControl>
                                {/* Key type detection display */}
                                {detectedKeyType && (
                                  <div className="text-sm mt-2">
                                    <span className="text-muted-foreground">Detected key type: </span>
                                    <span className={`font-medium ${
                                      detectedKeyType === 'invalid' || detectedKeyType === 'error'
                                        ? 'text-destructive'
                                        : 'text-green-600'
                                    }`}>
                                      {getFriendlyKeyTypeName(detectedKeyType)}
                                    </span>
                                    {keyDetectionLoading && (
                                      <span className="ml-2 text-muted-foreground">(detecting...)</span>
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
                              <FormItem className="mb-4 flex flex-col">
                                <FormLabel className="mb-2 min-h-[20px]">
                                  {t("credentials.sshPublicKey")} ({t("credentials.optional")})
                                </FormLabel>
                                <FormControl>
                                  <textarea
                                    placeholder={t(
                                      "placeholders.pastePublicKey",
                                    )}
                                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={field.value || ""}
                                    onChange={(e) => {
                                      field.onChange(e.target.value);
                                      // Trigger public key type detection with debounce
                                      debouncedPublicKeyDetection(e.target.value);
                                      // Trigger key pair validation if private key is available
                                      const privateKeyValue = form.watch("key");
                                      if (privateKeyValue && typeof privateKeyValue === "string" && privateKeyValue.trim()) {
                                        debouncedKeyPairValidation(privateKeyValue, e.target.value, form.watch("keyPassword"));
                                      }
                                    }}
                                  />
                                </FormControl>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t("credentials.publicKeyNote")}
                                </div>
                                {/* Public key type detection display for paste mode */}
                                {detectedPublicKeyType && field.value && (
                                  <div className="text-sm mt-2">
                                    <span className="text-muted-foreground">Detected key type: </span>
                                    <span className={`font-medium ${
                                      detectedPublicKeyType === 'invalid' || detectedPublicKeyType === 'error'
                                        ? 'text-destructive'
                                        : 'text-green-600'
                                    }`}>
                                      {getFriendlyKeyTypeName(detectedPublicKeyType)}
                                    </span>
                                    {publicKeyDetectionLoading && (
                                      <span className="ml-2 text-muted-foreground">(detecting...)</span>
                                    )}
                                  </div>
                                )}
                              </FormItem>
                            )}
                          />
                        </div>
                        {/* Key pair validation display */}
                        {(form.watch("key") && form.watch("publicKey") &&
                          typeof form.watch("key") === "string" && form.watch("key").trim() &&
                          form.watch("publicKey").trim()) && (
                          <div className="mt-4 p-3 border rounded-md bg-muted/50">
                            <div className="text-sm font-medium mb-1">Key Pair Validation</div>
                            {keyPairValidation.loading && (
                              <div className="text-sm text-muted-foreground">
                                <span>Validating key pair...</span>
                              </div>
                            )}
                            {!keyPairValidation.loading && keyPairValidation.isValid === true && (
                              <div className="text-sm text-green-600 font-medium">
                                ✓ Private and public keys match
                              </div>
                            )}
                            {!keyPairValidation.loading && keyPairValidation.isValid === false && (
                              <div className="text-sm text-destructive">
                                ✗ Keys do not match: {keyPairValidation.error}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-15 gap-4 mt-4">
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
                          <FormField
                            control={form.control}
                            name="keyType"
                            render={({ field }) => (
                              <FormItem className="relative col-span-3">
                                <FormLabel>
                                  {t("credentials.keyType")}
                                </FormLabel>
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
                                      )?.label || t("credentials.keyTypeRSA")}
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
                    </Tabs>
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
