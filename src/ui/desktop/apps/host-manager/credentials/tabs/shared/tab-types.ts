import type { UseFormReturn } from "react-hook-form";
import type React from "react";

export interface CredentialGeneralTabProps {
  form: UseFormReturn<FormData>;
  folders: string[];
  tagInput: string;
  setTagInput: (value: string) => void;
  folderDropdownOpen: boolean;
  setFolderDropdownOpen: (value: boolean) => void;
  folderInputRef: React.RefObject<HTMLInputElement>;
  folderDropdownRef: React.RefObject<HTMLDivElement>;
  filteredFolders: string[];
  handleFolderClick: (folder: string) => void;
}

export interface CredentialAuthenticationTabProps {
  form: UseFormReturn<FormData>;
  authTab: "password" | "key";
  setAuthTab: (value: "password" | "key") => void;
  detectedKeyType: string | null;
  setDetectedKeyType: (value: string | null) => void;
  keyDetectionLoading: boolean;
  setKeyDetectionLoading: (value: boolean) => void;
  detectedPublicKeyType: string | null;
  setDetectedPublicKeyType: (value: string | null) => void;
  publicKeyDetectionLoading: boolean;
  setPublicKeyDetectionLoading: (value: boolean) => void;
  keyDetectionTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  publicKeyDetectionTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  editorTheme: unknown;
  debouncedKeyDetection: (keyValue: string, keyPassword?: string) => void;
  debouncedPublicKeyDetection: (publicKeyValue: string) => void;
  getFriendlyKeyTypeName: (keyType: string) => string;
}
