import React from "react";
import { Controller } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Button } from "@/components/ui/button.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import type { Control, UseFormWatch, UseFormSetValue } from "react-hook-form";

interface CredentialAuthenticationTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  authTab: "password" | "key";
  setAuthTab: (tab: "password" | "key") => void;
  editorTheme: any;
  detectedKeyType: string | null;
  keyDetectionLoading: boolean;
  detectedPublicKeyType: string | null;
  publicKeyDetectionLoading: boolean;
  debouncedKeyDetection: (keyValue: string, keyPassword?: string) => void;
  debouncedPublicKeyDetection: (publicKeyValue: string) => void;
  generateKeyPair: (
    type: string,
    bits?: number,
    passphrase?: string,
  ) => Promise<{
    success: boolean;
    privateKey: string;
    publicKey: string;
    error?: string;
  }>;
  generatePublicKeyFromPrivate: (
    privateKey: string,
    passphrase?: string,
  ) => Promise<{ success: boolean; publicKey?: string; error?: string }>;
  getFriendlyKeyTypeName: (keyType: string) => string;
  t: (key: string, params?: any) => string;
}

export function CredentialAuthenticationTab({
  control,
  watch,
  setValue,
  authTab,
  setAuthTab,
  editorTheme,
  detectedKeyType,
  keyDetectionLoading,
  detectedPublicKeyType,
  publicKeyDetectionLoading,
  debouncedKeyDetection,
  debouncedPublicKeyDetection,
  generateKeyPair,
  generatePublicKeyFromPrivate,
  getFriendlyKeyTypeName,
  t,
}: CredentialAuthenticationTabProps) {
  return (
    <>
      <FormLabel className="mb-2 font-bold">
        {t("credentials.authentication")}
      </FormLabel>
      <Tabs
        value={authTab}
        onValueChange={(value) => {
          const newAuthType = value as "password" | "key";
          setAuthTab(newAuthType);
          setValue("authType", newAuthType);

          setValue("password", "");
          setValue("key", null);
          setValue("keyPassword", "");
          setValue("keyType", "auto");
        }}
        className="flex-1 flex flex-col h-full min-h-0"
      >
        <TabsList className="bg-button border border-edge-medium">
          <TabsTrigger
            value="password"
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
          >
            {t("credentials.password")}
          </TabsTrigger>
          <TabsTrigger
            value="key"
            className="bg-button data-[state=active]:bg-elevated data-[state=active]:border data-[state=active]:border-edge-medium"
          >
            {t("credentials.key")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <FormField
            control={control}
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
            <div className="mb-3 p-3 border border-muted rounded-md">
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
                      const currentKeyPassword = watch("keyPassword");
                      const result = await generateKeyPair(
                        "ssh-ed25519",
                        undefined,
                        currentKeyPassword,
                      );

                      if (result.success) {
                        setValue("key", result.privateKey);
                        setValue("publicKey", result.publicKey);
                        debouncedKeyDetection(
                          result.privateKey,
                          currentKeyPassword,
                        );
                        debouncedPublicKeyDetection(result.publicKey);
                        toast.success(
                          t("credentials.keyPairGeneratedSuccessfully", {
                            keyType: "Ed25519",
                          }),
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
                      toast.error(t("credentials.failedToGenerateKeyPair"));
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
                      const currentKeyPassword = watch("keyPassword");
                      const result = await generateKeyPair(
                        "ecdsa-sha2-nistp256",
                        undefined,
                        currentKeyPassword,
                      );

                      if (result.success) {
                        setValue("key", result.privateKey);
                        setValue("publicKey", result.publicKey);
                        debouncedKeyDetection(
                          result.privateKey,
                          currentKeyPassword,
                        );
                        debouncedPublicKeyDetection(result.publicKey);
                        toast.success(
                          t("credentials.keyPairGeneratedSuccessfully", {
                            keyType: "ECDSA",
                          }),
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
                      toast.error(t("credentials.failedToGenerateKeyPair"));
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
                      const currentKeyPassword = watch("keyPassword");
                      const result = await generateKeyPair(
                        "ssh-rsa",
                        2048,
                        currentKeyPassword,
                      );

                      if (result.success) {
                        setValue("key", result.privateKey);
                        setValue("publicKey", result.publicKey);
                        debouncedKeyDetection(
                          result.privateKey,
                          currentKeyPassword,
                        );
                        debouncedPublicKeyDetection(result.publicKey);
                        toast.success(
                          t("credentials.keyPairGeneratedSuccessfully", {
                            keyType: "RSA",
                          }),
                        );
                      } else {
                        toast.error(
                          result.error ||
                            t("credentials.failedToGenerateKeyPair"),
                        );
                      }
                    } catch (error) {
                      console.error("Failed to generate RSA key pair:", error);
                      toast.error(t("credentials.failedToGenerateKeyPair"));
                    }
                  }}
                >
                  {t("credentials.generateRSA")}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-start">
              <Controller
                control={control}
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
                                  watch("keyPassword"),
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
                          typeof field.value === "string" ? field.value : ""
                        }
                        onChange={(value) => {
                          field.onChange(value);
                          debouncedKeyDetection(value, watch("keyPassword"));
                        }}
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
                          searchKeymap: false,
                          scrollPastEnd: false,
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
                control={control}
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
                                debouncedPublicKeyDetection(fileContent);
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
                          const privateKey = watch("key");
                          if (
                            !privateKey ||
                            typeof privateKey !== "string" ||
                            !privateKey.trim()
                          ) {
                            toast.error(
                              t("credentials.privateKeyRequiredForGeneration"),
                            );
                            return;
                          }

                          try {
                            const keyPassword = watch("keyPassword");
                            const result = await generatePublicKeyFromPrivate(
                              privateKey,
                              keyPassword,
                            );

                            if (result.success && result.publicKey) {
                              field.onChange(result.publicKey);
                              debouncedPublicKeyDetection(result.publicKey);

                              toast.success(
                                t("credentials.publicKeyGeneratedSuccessfully"),
                              );
                            } else {
                              toast.error(
                                result.error ||
                                  t("credentials.failedToGeneratePublicKey"),
                              );
                            }
                          } catch (error) {
                            console.error(
                              "Failed to generate public key:",
                              error,
                            );
                            toast.error(
                              t("credentials.failedToGeneratePublicKey"),
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
                        theme={editorTheme}
                        className="border border-input rounded-md overflow-hidden"
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
                              scrollbarWidth: "thin",
                              scrollbarColor:
                                "var(--scrollbar-thumb) var(--scrollbar-track)",
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
                          {getFriendlyKeyTypeName(detectedPublicKeyType)}
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
                control={control}
                name="keyPassword"
                render={({ field }) => (
                  <FormItem className="col-span-8">
                    <FormLabel>{t("credentials.keyPassword")}</FormLabel>
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
    </>
  );
}
