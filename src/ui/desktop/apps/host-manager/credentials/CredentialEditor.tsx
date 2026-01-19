import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button.tsx";
import { Form } from "@/components/ui/form.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createCredential,
  updateCredential,
  getCredentials,
  getCredentialDetails,
  detectKeyType,
  detectPublicKeyType,
} from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { oneDark } from "@codemirror/theme-one-dark";
import { githubLight } from "@uiw/codemirror-theme-github";
import { useTheme } from "@/components/theme-provider.tsx";
import type {
  Credential,
  CredentialEditorProps,
  CredentialData,
} from "../../../../../types";
import { CredentialGeneralTab } from "./tabs/CredentialGeneralTab";
import { CredentialAuthenticationTab } from "./tabs/CredentialAuthenticationTab";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

export function CredentialEditor({
  editingCredential,
  onFormSubmit,
}: CredentialEditorProps) {
  const { t } = useTranslation();
  const { theme: appTheme } = useTheme();

  const isDarkMode =
    appTheme === "dark" ||
    (appTheme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const editorTheme = isDarkMode ? oneDark : githubLight;
  const [, setCredentials] = useState<Credential[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [, setLoading] = useState(true);
  const [fullCredentialDetails, setFullCredentialDetails] =
    useState<Credential | null>(null);

  const [authTab, setAuthTab] = useState<"password" | "key">("password");
  const [detectedKeyType, setDetectedKeyType] = useState<string | null>(null);
  const [keyDetectionLoading, setKeyDetectionLoading] = useState(false);
  const keyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeTab, setActiveTab] = useState("general");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [detectedPublicKeyType, setDetectedPublicKeyType] = useState<
    string | null
  >(null);
  const [publicKeyDetectionLoading, setPublicKeyDetectionLoading] =
    useState(false);
  const publicKeyDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setFormError(null);
  }, [activeTab]);

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
      } catch {
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
        } catch {
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
    resolver: zodResolver(formSchema) as unknown as Parameters<
      typeof useForm<FormData>
    >[0]["resolver"],
    mode: "all",
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

  const watchedFields = form.watch();

  const isFormValid = React.useMemo(() => {
    const values = form.getValues();

    if (!values.name || !values.username) return false;

    if (authTab === "password") {
      return !!(values.password && values.password.trim() !== "");
    } else if (authTab === "key") {
      if (editingCredential) {
        return true;
      }
      return !!values.key;
    }

    return false;
  }, [watchedFields, authTab, editingCredential]);

  useEffect(() => {
    const updateAuthFields = async () => {
      form.setValue("authType", authTab, { shouldValidate: true });

      if (authTab === "password") {
        form.setValue("key", null, { shouldValidate: true });
        form.setValue("publicKey", "", { shouldValidate: true });
        form.setValue("keyPassword", "", { shouldValidate: true });
        form.setValue("keyType", "auto", { shouldValidate: true });
      } else if (authTab === "key") {
        form.setValue("password", "", { shouldValidate: true });
      }

      await form.trigger();
    };

    updateAuthFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authTab]);

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
            (fullCredentialDetails.keyType as string) || ("auto" as const);
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
      "ssh-rsa": t("credentials.keyTypeRSA"),
      "ssh-ed25519": t("credentials.keyTypeEd25519"),
      "ecdsa-sha2-nistp256": t("credentials.keyTypeEcdsaP256"),
      "ecdsa-sha2-nistp384": t("credentials.keyTypeEcdsaP384"),
      "ecdsa-sha2-nistp521": t("credentials.keyTypeEcdsaP521"),
      "ssh-dss": t("credentials.keyTypeDsa"),
      "rsa-sha2-256": t("credentials.keyTypeRsaSha256"),
      "rsa-sha2-512": t("credentials.keyTypeRsaSha512"),
      invalid: t("credentials.invalidKey"),
      error: t("credentials.detectionError"),
      unknown: t("credentials.unknown"),
    };
    return keyTypeMap[keyType] || keyType;
  };

  const onSubmit = async (data: FormData) => {
    try {
      setIsSubmitting(true);
      setFormError(null);

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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormError = () => {
    const errors = form.formState.errors;

    if (
      errors.name ||
      errors.username ||
      errors.description ||
      errors.folder ||
      errors.tags
    ) {
      setActiveTab("general");
    } else if (
      errors.password ||
      errors.key ||
      errors.publicKey ||
      errors.keyPassword ||
      errors.keyType
    ) {
      setActiveTab("authentication");
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
      className="flex-1 flex flex-col h-full min-h-0 w-full relative"
      key={editingCredential?.id || "new"}
    >
      <SimpleLoader
        visible={isSubmitting}
        message={
          editingCredential
            ? t("credentials.updatingCredential")
            : t("credentials.savingCredential")
        }
        backgroundColor="var(--bg-base)"
      />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit, handleFormError)}
          className="flex flex-col flex-1 min-h-0 h-full"
        >
          <ScrollArea className="flex-1 min-h-0 w-full my-1 pb-2">
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
                <TabsTrigger
                  value="general"
                  className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                >
                  {t("credentials.general")}
                </TabsTrigger>
                <TabsTrigger
                  value="authentication"
                  className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
                >
                  {t("credentials.authentication")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="general" className="pt-2">
                <CredentialGeneralTab
                  form={form}
                  folders={folders}
                  tagInput={tagInput}
                  setTagInput={setTagInput}
                  folderDropdownOpen={folderDropdownOpen}
                  setFolderDropdownOpen={setFolderDropdownOpen}
                  folderInputRef={folderInputRef}
                  folderDropdownRef={folderDropdownRef}
                  filteredFolders={filteredFolders}
                  handleFolderClick={handleFolderClick}
                />
              </TabsContent>
              <TabsContent value="authentication">
                <CredentialAuthenticationTab
                  form={form}
                  authTab={authTab}
                  setAuthTab={setAuthTab}
                  detectedKeyType={detectedKeyType}
                  setDetectedKeyType={setDetectedKeyType}
                  keyDetectionLoading={keyDetectionLoading}
                  setKeyDetectionLoading={setKeyDetectionLoading}
                  detectedPublicKeyType={detectedPublicKeyType}
                  setDetectedPublicKeyType={setDetectedPublicKeyType}
                  publicKeyDetectionLoading={publicKeyDetectionLoading}
                  setPublicKeyDetectionLoading={setPublicKeyDetectionLoading}
                  keyDetectionTimeoutRef={keyDetectionTimeoutRef}
                  publicKeyDetectionTimeoutRef={publicKeyDetectionTimeoutRef}
                  editorTheme={editorTheme}
                  debouncedKeyDetection={debouncedKeyDetection}
                  debouncedPublicKeyDetection={debouncedPublicKeyDetection}
                  getFriendlyKeyTypeName={getFriendlyKeyTypeName}
                />
              </TabsContent>
            </Tabs>
          </ScrollArea>
          <footer className="shrink-0 w-full pb-0">
            <Separator className="p-0.25" />
            {!isSubmitting && (
              <Button
                className="translate-y-2"
                type="submit"
                variant="outline"
                disabled={!isFormValid}
              >
                {editingCredential
                  ? t("credentials.updateCredential")
                  : t("credentials.addCredential")}
              </Button>
            )}
          </footer>
        </form>
      </Form>
    </div>
  );
}
