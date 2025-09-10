import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React, { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { createCredential, updateCredential, getCredentials, getCredentialDetails } from '@/ui/main-axios'
import { useTranslation } from "react-i18next"
import type { Credential, CredentialEditorProps, CredentialData } from '../../../../types/index.js'

export function CredentialEditor({ editingCredential, onFormSubmit }: CredentialEditorProps) {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [fullCredentialDetails, setFullCredentialDetails] = useState<Credential | null>(null);

    const [authTab, setAuthTab] = useState<'password' | 'key'>('password');
    const [keyInputMethod, setKeyInputMethod] = useState<'upload' | 'paste'>('upload');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const credentialsData = await getCredentials();
                setCredentials(credentialsData);

                const uniqueFolders = [...new Set(
                    credentialsData
                        .filter(credential => credential.folder && credential.folder.trim() !== '')
                        .map(credential => credential.folder!)
                )].sort() as string[];

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
                    console.error('Failed to fetch credential details:', error);
                    toast.error(t('credentials.failedToFetchCredentialDetails'));
                }
            } else {
                setFullCredentialDetails(null);
            }
        };

        fetchCredentialDetails();
    }, [editingCredential, t]);

    const formSchema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        folder: z.string().optional(),
        tags: z.array(z.string().min(1)).default([]),
        authType: z.enum(['password', 'key']),
        username: z.string().min(1),
        password: z.string().optional(),
        key: z.any().optional().nullable(),
        keyPassword: z.string().optional(),
        keyType: z.enum([
            'auto',
            'ssh-rsa',
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
            'ssh-dss',
            'ssh-rsa-sha2-256',
            'ssh-rsa-sha2-512',
        ]).optional(),
    }).superRefine((data, ctx) => {
        if (data.authType === 'password') {
            if (!data.password || data.password.trim() === '') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t('credentials.passwordRequired'),
                    path: ['password']
                });
            }
        } else if (data.authType === 'key') {
            if (!data.key && !editingCredential) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t('credentials.sshKeyRequired'),
                    path: ['key']
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
            keyPassword: "",
            keyType: "auto",
        }
    });

    useEffect(() => {
        if (editingCredential && fullCredentialDetails) {
            const defaultAuthType = fullCredentialDetails.authType;
            setAuthTab(defaultAuthType);

            // Force form reset with a small delay to ensure proper rendering
            setTimeout(() => {
                const formData = {
                    name: fullCredentialDetails.name || "",
                    description: fullCredentialDetails.description || "",
                    folder: fullCredentialDetails.folder || "",
                    tags: fullCredentialDetails.tags || [],
                    authType: defaultAuthType as 'password' | 'key',
                    username: fullCredentialDetails.username || "",
                    password: "",
                    key: null,
                    keyPassword: "",
                    keyType: "auto" as const,
                };
                
                // Only set the relevant authentication fields based on authType
                if (defaultAuthType === 'password') {
                    formData.password = fullCredentialDetails.password || "";
                } else if (defaultAuthType === 'key') {
                    formData.key = "existing_key"; // Placeholder to indicate existing key
                    formData.keyPassword = fullCredentialDetails.keyPassword || "";
                    formData.keyType = (fullCredentialDetails.keyType as any) || "auto" as const;
                }
                
                form.reset(formData);
                setTagInput("");
            }, 100);
        } else if (!editingCredential) {
            setAuthTab('password');
            form.reset({
                name: "",
                description: "",
                folder: "",
                tags: [],
                authType: "password",
                username: "",
                password: "",
                key: null,
                keyPassword: "",
                keyType: "auto",
            });
            setTagInput("");
        }
    }, [editingCredential?.id, fullCredentialDetails, form]);

    const onSubmit = async (data: FormData) => {
        try {
            if (!data.name || data.name.trim() === '') {
                data.name = data.username;
            }

            const submitData: CredentialData = {
                name: data.name,
                description: data.description,
                folder: data.folder,
                tags: data.tags,
                authType: data.authType,
                username: data.username,
                keyType: data.keyType
            };

            submitData.password = null;
            submitData.key = null;
            submitData.keyPassword = null;
            submitData.keyType = null;

            if (data.authType === 'password') {
                submitData.password = data.password;
            } else if (data.authType === 'key') {
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

            if (editingCredential) {
                await updateCredential(editingCredential.id, submitData);
                toast.success(t('credentials.credentialUpdatedSuccessfully', { name: data.name }));
            } else {
                await createCredential(submitData);
                toast.success(t('credentials.credentialAddedSuccessfully', { name: data.name }));
            }

            if (onFormSubmit) {
                onFormSubmit();
            }

            window.dispatchEvent(new CustomEvent('credentials:changed'));
            
            // Reset form after successful submission
            form.reset();
        } catch (error) {
            toast.error(t('credentials.failedToSaveCredential'));
        }
    };

    const [tagInput, setTagInput] = useState("");

    const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const folderDropdownRef = useRef<HTMLDivElement>(null);

    const folderValue = form.watch('folder');
    const filteredFolders = React.useMemo(() => {
        if (!folderValue) return folders;
        return folders.filter(f => f.toLowerCase().includes(folderValue.toLowerCase()));
    }, [folderValue, folders]);

    const handleFolderClick = (folder: string) => {
        form.setValue('folder', folder);
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
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [folderDropdownOpen]);

    const keyTypeOptions = [
        { value: 'auto', label: t('hosts.autoDetect') },
        { value: 'ssh-rsa', label: t('hosts.rsa') },
        { value: 'ssh-ed25519', label: t('hosts.ed25519') },
        { value: 'ecdsa-sha2-nistp256', label: t('hosts.ecdsaNistP256') },
        { value: 'ecdsa-sha2-nistp384', label: t('hosts.ecdsaNistP384') },
        { value: 'ecdsa-sha2-nistp521', label: t('hosts.ecdsaNistP521') },
        { value: 'ssh-dss', label: t('hosts.dsa') },
        { value: 'ssh-rsa-sha2-256', label: t('hosts.rsaSha2256') },
        { value: 'ssh-rsa-sha2-512', label: t('hosts.rsaSha2512') },
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
        <div className="flex-1 flex flex-col h-full min-h-0 w-full" key={editingCredential?.id || 'new'}>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0 h-full">
                    <ScrollArea className="flex-1 min-h-0 w-full my-1 pb-2">
                        <Tabs defaultValue="general" className="w-full">
                            <TabsList>
                                <TabsTrigger value="general">{t('credentials.general')}</TabsTrigger>
                                <TabsTrigger value="authentication">{t('credentials.authentication')}</TabsTrigger>
                            </TabsList>
                            <TabsContent value="general" className="pt-2">
                                <FormLabel className="mb-3 font-bold">{t('credentials.basicInformation')}</FormLabel>
                                <div className="grid grid-cols-12 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="col-span-6">
                                                <FormLabel>{t('credentials.credentialName')}</FormLabel>
                                                <FormControl>
                                                    <Input placeholder={t('placeholders.credentialName')} {...field} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="username"
                                        render={({ field }) => (
                                            <FormItem className="col-span-6">
                                                <FormLabel>{t('credentials.username')}</FormLabel>
                                                <FormControl>
                                                    <Input placeholder={t('placeholders.username')} {...field} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormLabel className="mb-3 mt-3 font-bold">{t('credentials.organization')}</FormLabel>
                                <div className="grid grid-cols-26 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem className="col-span-10">
                                                <FormLabel>{t('credentials.description')}</FormLabel>
                                                <FormControl>
                                                    <Input placeholder={t('placeholders.description')} {...field} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="folder"
                                        render={({ field }) => (
                                            <FormItem className="col-span-10 relative">
                                                <FormLabel>{t('credentials.folder')}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        ref={folderInputRef}
                                                        placeholder={t('placeholders.folder')}
                                                        className="min-h-[40px]"
                                                        autoComplete="off"
                                                        value={field.value}
                                                        onFocus={() => setFolderDropdownOpen(true)}
                                                        onChange={e => {
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
                                                <FormLabel>{t('credentials.tags')}</FormLabel>
                                                <FormControl>
                                                    <div
                                                        className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-dark-bg-input focus-within:ring-2 ring-ring min-h-[40px]">
                                                        {(field.value || []).map((tag: string, idx: number) => (
                                                            <span key={`${tag}-${idx}`}
                                                                  className="flex items-center bg-gray-200 text-gray-800 rounded-full px-2 py-0.5 text-xs">
                                                                {tag}
                                                                <button
                                                                    type="button"
                                                                    className="ml-1 text-gray-500 hover:text-red-500 focus:outline-none"
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        const newTags = (field.value || []).filter((_: string, i: number) => i !== idx);
                                                                        field.onChange(newTags);
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </span>
                                                        ))}
                                                        <input
                                                            type="text"
                                                            className="flex-1 min-w-[60px] border-none outline-none bg-transparent p-0 h-6 text-sm"
                                                            value={tagInput}
                                                            onChange={e => setTagInput(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === " " && tagInput.trim() !== "") {
                                                                    e.preventDefault();
                                                                    const currentTags = field.value || [];
                                                                    if (!currentTags.includes(tagInput.trim())) {
                                                                        field.onChange([...currentTags, tagInput.trim()]);
                                                                    }
                                                                    setTagInput("");
                                                                } else if (e.key === "Enter" && tagInput.trim() !== "") {
                                                                    e.preventDefault();
                                                                    const currentTags = field.value || [];
                                                                    if (!currentTags.includes(tagInput.trim())) {
                                                                        field.onChange([...currentTags, tagInput.trim()]);
                                                                    }
                                                                    setTagInput("");
                                                                } else if (e.key === "Backspace" && tagInput === "" && (field.value || []).length > 0) {
                                                                    const currentTags = field.value || [];
                                                                    field.onChange(currentTags.slice(0, -1));
                                                                }
                                                            }}
                                                            placeholder={t('credentials.addTagsSpaceToAdd')}
                                                        />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </TabsContent>
                            <TabsContent value="authentication">
                                <FormLabel className="mb-3 font-bold">{t('credentials.authentication')}</FormLabel>
                                <Tabs
                                    value={authTab}
                                    onValueChange={(value) => {
                                        const newAuthType = value as 'password' | 'key';
                                        setAuthTab(newAuthType);
                                        form.setValue('authType', newAuthType);
                                        
                                        // Clear ALL authentication fields first
                                        form.setValue('password', '');
                                        form.setValue('key', null);
                                        form.setValue('keyPassword', '');
                                        form.setValue('keyType', 'auto');
                                        
                                        // Then set only the relevant fields based on auth type
                                        if (newAuthType === 'password') {
                                            // Password fields will be filled by user
                                        } else if (newAuthType === 'key') {
                                            // Key fields will be filled by user
                                        }
                                    }}
                                    className="flex-1 flex flex-col h-full min-h-0"
                                >
                                    <TabsList>
                                        <TabsTrigger value="password">{t('credentials.password')}</TabsTrigger>
                                        <TabsTrigger value="key">{t('credentials.key')}</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="password">
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t('credentials.password')}</FormLabel>
                                                    <FormControl>
                                                        <PasswordInput placeholder={t('placeholders.password')} {...field} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </TabsContent>
                                    <TabsContent value="key">
                                        <Tabs
                                            value={keyInputMethod}
                                            onValueChange={(value) => {
                                                setKeyInputMethod(value as 'upload' | 'paste');
                                                // Clear the other field when switching
                                                if (value === 'upload') {
                                                    form.setValue('key', null);
                                                } else {
                                                    form.setValue('key', '');
                                                }
                                            }}
                                            className="w-full"
                                        >
                                            <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                                                <TabsTrigger value="upload">{t('hosts.uploadFile')}</TabsTrigger>
                                                <TabsTrigger value="paste">{t('hosts.pasteKey')}</TabsTrigger>
                                            </TabsList>
                                            <TabsContent value="upload" className="mt-4">
                                                <Controller
                                                    control={form.control}
                                                    name="key"
                                                    render={({ field }) => (
                                                        <FormItem className="mb-4">
                                                            <FormLabel>{t('credentials.sshPrivateKey')}</FormLabel>
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
                                                                        <span className="truncate"
                                                                              title={field.value?.name || t('credentials.upload')}>
                                                                            {field.value === "existing_key" ? t('hosts.existingKey') : 
                                                                             field.value ? (editingCredential ? t('credentials.updateKey') : field.value.name) : t('credentials.upload')}
                                                                        </span>
                                                                    </Button>
                                                                </div>
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <div className="grid grid-cols-15 gap-4 mt-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="keyPassword"
                                                        render={({ field }) => (
                                                            <FormItem className="col-span-8">
                                                                <FormLabel>{t('credentials.keyPassword')}</FormLabel>
                                                                <FormControl>
                                                                    <PasswordInput
                                                                        placeholder={t('placeholders.keyPassword')}
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
                                                                <FormLabel>{t('credentials.keyType')}</FormLabel>
                                                                <FormControl>
                                                                    <div className="relative">
                                                                        <Button
                                                                            ref={keyTypeButtonRef}
                                                                            type="button"
                                                                            variant="outline"
                                                                            className="w-full justify-start text-left rounded-md px-2 py-2 bg-dark-bg border border-input text-foreground"
                                                                            onClick={() => setKeyTypeDropdownOpen((open) => !open)}
                                                                        >
                                                                            {keyTypeOptions.find((opt) => opt.value === field.value)?.label || t('credentials.keyTypeRSA')}
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
                                                <Controller
                                                    control={form.control}
                                                    name="key"
                                                    render={({ field }) => (
                                                        <FormItem className="mb-4">
                                                            <FormLabel>{t('credentials.sshPrivateKey')}</FormLabel>
                                                            <FormControl>
                                                                <textarea
                                                                    placeholder={t('placeholders.pastePrivateKey')}
                                                                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    value={typeof field.value === 'string' ? field.value : ''}
                                                                    onChange={(e) => field.onChange(e.target.value)}
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <div className="grid grid-cols-15 gap-4 mt-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="keyPassword"
                                                        render={({ field }) => (
                                                            <FormItem className="col-span-8">
                                                                <FormLabel>{t('credentials.keyPassword')}</FormLabel>
                                                                <FormControl>
                                                                    <PasswordInput
                                                                        placeholder={t('placeholders.keyPassword')}
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
                                                                <FormLabel>{t('credentials.keyType')}</FormLabel>
                                                                <FormControl>
                                                                    <div className="relative">
                                                                        <Button
                                                                            ref={keyTypeButtonRef}
                                                                            type="button"
                                                                            variant="outline"
                                                                            className="w-full justify-start text-left rounded-md px-2 py-2 bg-dark-bg border border-input text-foreground"
                                                                            onClick={() => setKeyTypeDropdownOpen((open) => !open)}
                                                                        >
                                                                            {keyTypeOptions.find((opt) => opt.value === field.value)?.label || t('credentials.keyTypeRSA')}
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
                        <Separator className="p-0.25"/>
                        <Button
                            className="translate-y-2"
                            type="submit"
                            variant="outline"
                        >
                            {editingCredential ? t('credentials.updateCredential') : t('credentials.addCredential')}
                        </Button>
                    </footer>
                </form>
            </Form>
        </div>
    );
}