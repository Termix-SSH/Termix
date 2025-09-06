import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { 
    X, 
    Plus, 
    Eye, 
    EyeOff, 
    Upload, 
    Download, 
    Key, 
    Shield, 
    AlertTriangle,
    Check,
    Tag,
    Folder,
    User,
    Lock
} from 'lucide-react';
import { createCredential, updateCredential, getCredentialFolders } from '@/ui/main-axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface Credential {
    id: number;
    name: string;
    description?: string;
    folder?: string;
    tags: string[];
    authType: 'password' | 'key';
    username: string;
    keyType?: string;
    usageCount: number;
    lastUsed?: string;
    createdAt: string;
    updatedAt: string;
}

interface CredentialInput {
    name: string;
    description?: string;
    folder?: string;
    tags: string[];
    authType: 'password' | 'key';
    username: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
}

interface CredentialEditorProps {
    credential?: Credential | null;
    onSave: () => void;
    onCancel: () => void;
}

const CredentialEditor: React.FC<CredentialEditorProps> = ({ credential, onSave, onCancel }) => {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<CredentialInput>({
        name: '',
        description: '',
        folder: '',
        tags: [],
        authType: 'password',
        username: '',
        password: '',
        key: '',
        keyPassword: '',
        keyType: 'rsa'
    });
    const [saving, setSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showKeyPassword, setShowKeyPassword] = useState(false);
    const [newTag, setNewTag] = useState('');
    const [existingFolders, setExistingFolders] = useState<string[]>([]);
    const [keyFile, setKeyFile] = useState<File | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (credential) {
            setFormData({
                name: credential.name,
                description: credential.description || '',
                folder: credential.folder || '',
                tags: [...credential.tags],
                authType: credential.authType,
                username: credential.username,
                password: '',
                key: '',
                keyPassword: '',
                keyType: credential.keyType || 'rsa'
            });
        }
        fetchExistingFolders();
    }, [credential]);

    const fetchExistingFolders = async () => {
        try {
            const response = await getCredentialFolders();
            setExistingFolders(response);
        } catch (error) {
            console.error('Failed to fetch folders:', error);
        }
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.name.trim()) {
            newErrors.name = t('credentials.nameIsRequired');
        }

        if (!formData.username.trim()) {
            newErrors.username = t('credentials.usernameIsRequired');
        }

        if (formData.authType === 'password' && !formData.password && !credential) {
            newErrors.password = t('credentials.passwordIsRequired');
        }

        if (formData.authType === 'key' && !formData.key && !credential) {
            newErrors.key = t('credentials.sshKeyIsRequired');
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        setSaving(true);
        try {
            const payload = { ...formData };
            
            // Don't send empty passwords/keys when editing unless they were changed
            if (credential) {
                if (!payload.password) delete payload.password;
                if (!payload.key) delete payload.key;
                if (!payload.keyPassword) delete payload.keyPassword;
            }

            if (credential && credential.id) {
                await updateCredential(credential.id, payload);
                toast.success(t('credentials.credentialUpdatedSuccessfully'));
            } else {
                await createCredential(payload);
                toast.success(t('credentials.credentialCreatedSuccessfully'));
            }

            onSave();
        } catch (error: any) {
            console.error('Failed to save credential:', error);
            toast.error(error.response?.data?.error || t('credentials.failedToSaveCredential'));
        } finally {
            setSaving(false);
        }
    };

    const handleAddTag = () => {
        if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
            setFormData(prev => ({
                ...prev,
                tags: [...prev.tags, newTag.trim()]
            }));
            setNewTag('');
        }
    };

    const handleRemoveTag = (tagToRemove: string) => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags.filter(tag => tag !== tagToRemove)
        }));
    };

    const handleKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setKeyFile(file);
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                setFormData(prev => ({ ...prev, key: content }));
            };
            reader.readAsText(file);
        }
    };

    const generateSSHKeyPair = () => {
        toast.info(t('credentials.sshKeyGenerationNotImplemented'));
    };

    const testConnection = () => {
        toast.info(t('credentials.connectionTestingNotImplemented'));
    };

    return (
        <Sheet open={true} onOpenChange={onCancel}>
            <SheetContent className="w-[600px] max-w-[50vw] overflow-y-auto">
                <SheetHeader className="space-y-4 pb-8">
                    <SheetTitle className="flex items-center space-x-3">
                        <Key className="h-6 w-6 text-zinc-600 dark:text-zinc-400" />
                        <span className="text-xl font-semibold">
                            {credential ? t('credentials.editCredential') : t('credentials.createCredential')}
                        </span>
                    </SheetTitle>
                    <SheetDescription className="text-base text-zinc-600 dark:text-zinc-400">
                        {credential 
                            ? t('credentials.editCredentialDescription') 
                            : t('credentials.createCredentialDescription')
                        }
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit} className="space-y-10 px-2">
                    <Tabs defaultValue="basic" className="w-full">
                        <TabsList className="grid w-full grid-cols-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                            <TabsTrigger value="basic">{t('credentials.basicInfo')}</TabsTrigger>
                            <TabsTrigger value="auth">{t('credentials.authentication')}</TabsTrigger>
                            <TabsTrigger value="organization">{t('credentials.organization')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="basic" className="space-y-8 mt-8">
                            <Card className="border-zinc-200 dark:border-zinc-700">
                                <CardHeader className="pb-8">
                                    <CardTitle className="text-lg font-semibold">{t('credentials.basicInformation')}</CardTitle>
                                    <CardDescription className="text-zinc-600 dark:text-zinc-400">
                                        {t('credentials.basicInformationDescription')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-8">
                                    <div className="space-y-4">
                                        <Label htmlFor="name" className="flex items-center space-x-2 text-sm font-medium">
                                            <User className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                                            <span>{t('credentials.credentialName')}</span>
                                            <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="name"
                                            value={formData.name}
                                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder={t('credentials.enterCredentialName')}
                                            className={errors.name ? 'border-red-500' : ''}
                                        />
                                        {errors.name && (
                                            <p className="text-sm text-red-500 flex items-center space-x-1">
                                                <AlertTriangle className="h-3 w-3" />
                                                <span>{errors.name}</span>
                                            </p>
                                        )}
                                    </div>

                                    <div className="space-y-4">
                                        <Label htmlFor="description">{t('credentials.credentialDescription')}</Label>
                                        <Textarea
                                            id="description"
                                            value={formData.description}
                                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                            placeholder={t('credentials.enterCredentialDescription')}
                                            rows={3}
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <Label htmlFor="username" className="flex items-center space-x-1">
                                            <User className="h-4 w-4" />
                                            <span>{t('common.username')}</span>
                                            <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="username"
                                            value={formData.username}
                                            onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                                            placeholder={t('credentials.enterUsername')}
                                            className={errors.username ? 'border-red-500' : ''}
                                        />
                                        {errors.username && (
                                            <p className="text-sm text-red-500 flex items-center space-x-1">
                                                <AlertTriangle className="h-3 w-3" />
                                                <span>{errors.username}</span>
                                            </p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="auth" className="space-y-6 mt-8">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center space-x-2">
                                        <Shield className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                                        <span>{t('credentials.authenticationMethod')}</span>
                                    </CardTitle>
                                    <CardDescription>
                                        {t('credentials.authenticationMethodDescription')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="space-y-4">
                                        <Label>{t('credentials.authenticationType')}</Label>
                                        <div className="flex space-x-6">
                                            <div 
                                                className={`flex-1 p-6 rounded-lg border-2 cursor-pointer transition-colors ${
                                                    formData.authType === 'password' 
                                                        ? 'border-zinc-500 bg-zinc-900/20 dark:bg-zinc-900/20' 
                                                        : 'border-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:hover:border-zinc-500'
                                                }`}
                                                onClick={() => setFormData(prev => ({ ...prev, authType: 'password' }))}
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <Lock className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                                                    <div>
                                                        <div className="font-medium">{t('common.password')}</div>
                                                        <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('credentials.passwordAuthDescription')}</div>
                                                    </div>
                                                    {formData.authType === 'password' && (
                                                        <Check className="h-5 w-5 text-zinc-500" />
                                                    )}
                                                </div>
                                            </div>
                                            <div 
                                                className={`flex-1 p-6 rounded-lg border-2 cursor-pointer transition-colors ${
                                                    formData.authType === 'key' 
                                                        ? 'border-zinc-500 bg-zinc-900/20 dark:bg-zinc-900/20' 
                                                        : 'border-zinc-600 hover:border-zinc-500 dark:border-zinc-600 dark:hover:border-zinc-500'
                                                }`}
                                                onClick={() => setFormData(prev => ({ ...prev, authType: 'key' }))}
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <Key className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                                                    <div>
                                                        <div className="font-medium">{t('credentials.sshKey')}</div>
                                                        <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('credentials.sshKeyAuthDescription')}</div>
                                                    </div>
                                                    {formData.authType === 'key' && (
                                                        <Check className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <Separator />

                                    {formData.authType === 'password' && (
                                        <div className="space-y-4">
                                            <Label htmlFor="password" className="flex items-center space-x-1">
                                                <Lock className="h-4 w-4" />
                                                <span>{t('common.password')}</span>
                                                {!credential && <span className="text-red-500">*</span>}
                                            </Label>
                                            <div className="relative">
                                                <Input
                                                    id="password"
                                                    type={showPassword ? 'text' : 'password'}
                                                    value={formData.password}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder={credential ? t('credentials.leaveEmptyToKeepCurrent') : t('credentials.enterPassword')}
                                                    className={`pr-10 ${errors.password ? 'border-red-500' : ''}`}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                            {errors.password && (
                                                <p className="text-sm text-red-500 flex items-center space-x-1">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    <span>{errors.password}</span>
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {formData.authType === 'key' && (
                                        <div className="space-y-6">
                                            <div className="space-y-4">
                                                <Label className="flex items-center space-x-1">
                                                    <Key className="h-4 w-4" />
                                                    <span>{t('credentials.sshKeyType')}</span>
                                                </Label>
                                                <Select value={formData.keyType} onValueChange={(value) => setFormData(prev => ({ ...prev, keyType: value }))}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="rsa">RSA</SelectItem>
                                                        <SelectItem value="ecdsa">ECDSA</SelectItem>
                                                        <SelectItem value="ed25519">Ed25519</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-4">
                                                <Label htmlFor="key" className="flex items-center space-x-1">
                                                    <Key className="h-4 w-4" />
                                                    <span>{t('credentials.privateKey')}</span>
                                                    {!credential && <span className="text-red-500">*</span>}
                                                </Label>
                                                <Textarea
                                                    id="key"
                                                    value={formData.key}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, key: e.target.value }))}
                                                    placeholder={credential ? t('credentials.leaveEmptyToKeepCurrent') : t('credentials.enterPrivateKey')}
                                                    rows={8}
                                                    className={`font-mono text-xs ${errors.key ? 'border-red-500' : ''}`}
                                                />
                                                {errors.key && (
                                                    <p className="text-sm text-red-500 flex items-center space-x-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        <span>{errors.key}</span>
                                                    </p>
                                                )}
                                                <div className="flex space-x-3">
                                                    <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('key-file')?.click()}>
                                                        <Upload className="h-4 w-4 mr-1" />
                                                        {t('credentials.uploadKeyFile')}
                                                    </Button>
                                                    <Button type="button" variant="outline" size="sm" onClick={generateSSHKeyPair}>
                                                        <Key className="h-4 w-4 mr-1" />
                                                        {t('credentials.generateKeyPair')}
                                                    </Button>
                                                </div>
                                                <input
                                                    id="key-file"
                                                    type="file"
                                                    accept=".pem,.key,.pub"
                                                    className="hidden"
                                                    onChange={handleKeyFileUpload}
                                                />
                                            </div>

                                            <div className="space-y-4">
                                                <Label htmlFor="keyPassword">{t('credentials.keyPassphrase')}</Label>
                                                <div className="relative">
                                                    <Input
                                                        id="keyPassword"
                                                        type={showKeyPassword ? 'text' : 'password'}
                                                        value={formData.keyPassword}
                                                        onChange={(e) => setFormData(prev => ({ ...prev, keyPassword: e.target.value }))}
                                                        placeholder={credential ? t('credentials.leaveEmptyToKeepCurrent') : t('credentials.enterKeyPassphrase')}
                                                        className="pr-10"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                                                        onClick={() => setShowKeyPassword(!showKeyPassword)}
                                                    >
                                                        {showKeyPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('credentials.keyPassphraseOptional')}</p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="organization" className="space-y-6 mt-8">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center space-x-2">
                                        <Folder className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                                        <span>{t('credentials.organization')}</span>
                                    </CardTitle>
                                    <CardDescription>
                                        {t('credentials.organizationDescription')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="space-y-4">
                                        <Label htmlFor="folder" className="flex items-center space-x-1">
                                            <Folder className="h-4 w-4" />
                                            <span>{t('common.folder')}</span>
                                        </Label>
                                        <Select value={formData.folder || "__none__"} onValueChange={(value) => setFormData(prev => ({ ...prev, folder: value === "__none__" ? "" : value }))}>
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('credentials.selectOrCreateFolder')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__">{t('credentials.noFolder')}</SelectItem>
                                                {existingFolders.map(folder => (
                                                    <SelectItem key={folder} value={folder}>{folder}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            placeholder={t('credentials.orCreateNewFolder')}
                                            value={formData.folder}
                                            onChange={(e) => setFormData(prev => ({ ...prev, folder: e.target.value }))}
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <Label className="flex items-center space-x-1">
                                            <Tag className="h-4 w-4" />
                                            <span>{t('hosts.tags')}</span>
                                        </Label>
                                        <div className="flex flex-wrap gap-3 mb-4">
                                            {formData.tags.map((tag, index) => (
                                                <Badge key={index} variant="secondary" className="pr-1">
                                                    {tag}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-4 w-4 p-0 ml-1 hover:bg-red-900/20 dark:hover:bg-red-900/30"
                                                        onClick={() => handleRemoveTag(tag)}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </Badge>
                                            ))}
                                        </div>
                                        <div className="flex space-x-3">
                                            <Input
                                                placeholder={t('credentials.addTag')}
                                                value={newTag}
                                                onChange={(e) => setNewTag(e.target.value)}
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddTag();
                                                    }
                                                }}
                                            />
                                            <Button type="button" variant="outline" size="sm" onClick={handleAddTag}>
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    <SheetFooter className="flex justify-end items-center pt-8 border-t border-zinc-200 dark:border-zinc-700">
                        <div className="flex space-x-4">
                            <Button type="button" variant="outline" size="lg" onClick={onCancel} className="border-zinc-300 dark:border-zinc-600">
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" size="lg" disabled={saving}>
                                {saving ? t('credentials.saving') : credential ? t('credentials.updateCredential') : t('credentials.createCredential')}
                            </Button>
                        </div>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
};

export default CredentialEditor;