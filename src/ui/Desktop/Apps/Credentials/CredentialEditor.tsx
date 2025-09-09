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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React, { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { createCredential, updateCredential, getCredentials, getCredentialDetails } from '@/ui/main-axios'
import { useTranslation } from "react-i18next"
import type { Credential, CredentialEditorProps } from '../../../types/index.js'

export function CredentialEditor({ editingCredential, onFormSubmit }: CredentialEditorProps) {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [fullCredentialDetails, setFullCredentialDetails] = useState<Credential | null>(null);

    const [authTab, setAuthTab] = useState<'password' | 'key'>('password');

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
            'rsa',
            'ecdsa',
            'ed25519'
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
            name: editingCredential?.name || "",
            description: editingCredential?.description || "",
            folder: editingCredential?.folder || "",
            tags: editingCredential?.tags || [],
            authType: editingCredential?.authType || "password",
            username: editingCredential?.username || "",
            password: "",
            key: null,
            keyPassword: "",
            keyType: "rsa",
        }
    });

    useEffect(() => {
        if (editingCredential && fullCredentialDetails) {
            const defaultAuthType = fullCredentialDetails.authType;

            setAuthTab(defaultAuthType);

            form.reset({
                name: fullCredentialDetails.name || "",
                description: fullCredentialDetails.description || "",
                folder: fullCredentialDetails.folder || "",
                tags: fullCredentialDetails.tags || [],
                authType: defaultAuthType as 'password' | 'key',
                username: fullCredentialDetails.username || "",
                password: fullCredentialDetails.password || "",
                key: null,
                keyPassword: fullCredentialDetails.keyPassword || "",
                keyType: (fullCredentialDetails.keyType as any) || "rsa",
            });
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
                keyType: "rsa",
            });
        }
    }, [editingCredential, fullCredentialDetails, form]);

    const onSubmit = async (data: any) => {
        try {
            const formData = data as FormData;

            if (!formData.name || formData.name.trim() === '') {
                formData.name = formData.username;
            }

            const submitData: any = {
                name: formData.name,
                description: formData.description,
                folder: formData.folder,
                tags: formData.tags,
                authType: formData.authType,
                username: formData.username,
                keyType: formData.keyType
            };

            if (formData.password !== undefined) {
                submitData.password = formData.password;
            }
            
            if (formData.key !== undefined) {
                if (formData.key instanceof File) {
                    const keyContent = await formData.key.text();
                    submitData.key = keyContent;
                } else {
                    submitData.key = formData.key;
                }
            }
            
            if (formData.keyPassword !== undefined) {
                submitData.keyPassword = formData.keyPassword;
            }

            if (editingCredential) {
                await updateCredential(editingCredential.id, submitData);
                toast.success(t('credentials.credentialUpdatedSuccessfully', { name: formData.name }));
            } else {
                await createCredential(submitData);
                toast.success(t('credentials.credentialAddedSuccessfully', { name: formData.name }));
            }

            if (onFormSubmit) {
                onFormSubmit();
            }

            window.dispatchEvent(new CustomEvent('credentials:changed'));
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
        { value: 'rsa', label: t('credentials.keyTypeRSA') },
        { value: 'ecdsa', label: t('credentials.keyTypeECDSA') },
        { value: 'ed25519', label: t('credentials.keyTypeEd25519') },
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
        <div className="flex-1 flex flex-col h-full min-h-0 w-full">
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
                                                        className="absolute top-full left-0 z-50 mt-1 w-full bg-[#18181b] border border-input rounded-md shadow-lg max-h-40 overflow-y-auto p-1"
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
                                                        className="flex flex-wrap items-center gap-1 border border-input rounded-md px-3 py-2 bg-[#222225] focus-within:ring-2 ring-ring min-h-[40px]">
                                                        {field.value.map((tag: string, idx: number) => (
                                                            <span key={tag + idx}
                                                                  className="flex items-center bg-gray-200 text-gray-800 rounded-full px-2 py-0.5 text-xs">
                                                                {tag}
                                                                <button
                                                                    type="button"
                                                                    className="ml-1 text-gray-500 hover:text-red-500 focus:outline-none"
                                                                    onClick={() => {
                                                                        const newTags = field.value.filter((_: string, i: number) => i !== idx);
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
                                                            onChange={e => setTagInput(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === " " && tagInput.trim() !== "") {
                                                                    e.preventDefault();
                                                                    if (!field.value.includes(tagInput.trim())) {
                                                                        field.onChange([...field.value, tagInput.trim()]);
                                                                    }
                                                                    setTagInput("");
                                                                } else if (e.key === "Backspace" && tagInput === "" && field.value.length > 0) {
                                                                    field.onChange(field.value.slice(0, -1));
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
                                        setAuthTab(value as 'password' | 'key');
                                        form.setValue('authType', value as 'password' | 'key');
                                        // Clear other auth fields when switching
                                        if (value === 'password') {
                                            form.setValue('key', null);
                                            form.setValue('keyPassword', '');
                                        } else if (value === 'key') {
                                            form.setValue('password', '');
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
                                                        <Input type="password" placeholder={t('placeholders.password')} {...field} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </TabsContent>
                                    <TabsContent value="key">
                                        <div className="grid grid-cols-15 gap-4">
                                            <Controller
                                                control={form.control}
                                                name="key"
                                                render={({ field }) => (
                                                    <FormItem className="col-span-4 overflow-hidden min-w-0">
                                                        <FormLabel>{t('credentials.sshPrivateKey')}</FormLabel>
                                                        <FormControl>
                                                            <div className="relative min-w-0">
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
                                                                    className="w-full min-w-0 overflow-hidden px-3 py-2 text-left"
                                                                >
                                                                    <span className="block w-full truncate"
                                                                          title={field.value?.name || t('credentials.upload')}>
                                                                        {field.value ? (editingCredential ? t('credentials.updateKey') : field.value.name) : t('credentials.upload')}
                                                                    </span>
                                                                </Button>
                                                            </div>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="keyPassword"
                                                render={({ field }) => (
                                                    <FormItem className="col-span-8">
                                                        <FormLabel>{t('credentials.keyPassword')}</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder={t('placeholders.keyPassword')}
                                                                type="password"
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
                                                                    className="w-full justify-start text-left rounded-md px-2 py-2 bg-[#18181b] border border-input text-foreground"
                                                                    onClick={() => setKeyTypeDropdownOpen((open) => !open)}
                                                                >
                                                                    {keyTypeOptions.find((opt) => opt.value === field.value)?.label || t('credentials.keyTypeRSA')}
                                                                </Button>
                                                                {keyTypeDropdownOpen && (
                                                                    <div
                                                                        ref={keyTypeDropdownRef}
                                                                        className="absolute bottom-full left-0 z-50 mb-1 w-full bg-[#18181b] border border-input rounded-md shadow-lg max-h-40 overflow-y-auto p-1"
                                                                    >
                                                                        <div className="grid grid-cols-1 gap-1 p-0">
                                                                            {keyTypeOptions.map((opt) => (
                                                                                <Button
                                                                                    key={opt.value}
                                                                                    type="button"
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    className="w-full justify-start text-left rounded-md px-2 py-1.5 bg-[#18181b] text-foreground hover:bg-white/15 focus:bg-white/20 focus:outline-none"
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
                    </ScrollArea>
                    <footer className="shrink-0 w-full pb-0">
                        <Separator className="p-0.25"/>
                        <Button
                            className=""
                            type="submit"
                            variant="outline"
                            style={{
                                transform: 'translateY(8px)'
                            }}
                        >
                            {editingCredential ? t('credentials.updateCredential') : t('credentials.addCredential')}
                        </Button>
                    </footer>
                </form>
            </Form>
        </div>
    );
}