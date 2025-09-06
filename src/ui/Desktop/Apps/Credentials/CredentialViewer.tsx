import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { 
    Key, 
    User, 
    Calendar, 
    Hash, 
    Folder,
    Edit3,
    Copy,
    Settings,
    Shield,
    Clock,
    Server,
    Eye,
    EyeOff,
    ExternalLink,
    AlertTriangle,
    CheckCircle,
    FileText
} from 'lucide-react';
import { getCredentialDetails, getCredentialHosts } from '@/ui/main-axios';
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

interface CredentialWithSecrets extends Credential {
    password?: string;
    key?: string;
    keyPassword?: string;
}

interface HostInfo {
    id: number;
    name?: string;
    ip: string;
    port: number;
    createdAt: string;
}

interface CredentialViewerProps {
    credential: Credential;
    onClose: () => void;
    onEdit: () => void;
}

const CredentialViewer: React.FC<CredentialViewerProps> = ({ credential, onClose, onEdit }) => {
    const { t } = useTranslation();
    const [credentialDetails, setCredentialDetails] = useState<CredentialWithSecrets | null>(null);
    const [hostsUsing, setHostsUsing] = useState<HostInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
    const [activeTab, setActiveTab] = useState<'overview' | 'security' | 'usage'>('overview');

    useEffect(() => {
        fetchCredentialDetails();
        fetchHostsUsing();
    }, [credential.id]);

    const fetchCredentialDetails = async () => {
        try {
            const response = await getCredentialDetails(credential.id);
            setCredentialDetails(response);
        } catch (error) {
            console.error('Failed to fetch credential details:', error);
            toast.error(t('credentials.failedToFetchCredentialDetails'));
        }
    };

    const fetchHostsUsing = async () => {
        try {
            const response = await getCredentialHosts(credential.id);
            setHostsUsing(response);
        } catch (error) {
            console.error('Failed to fetch hosts using credential:', error);
            toast.error(t('credentials.failedToFetchHostsUsing'));
        } finally {
            setLoading(false);
        }
    };

    const toggleSensitiveVisibility = (field: string) => {
        setShowSensitive(prev => ({
            ...prev,
            [field]: !prev[field]
        }));
    };

    const copyToClipboard = async (text: string, fieldName: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('copiedToClipboard', { field: fieldName }));
        } catch (error) {
            toast.error(t('credentials.failedToCopy'));
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const getAuthIcon = (authType: string) => {
        return authType === 'password' ? (
            <Key className="h-5 w-5 text-orange-500" />
        ) : (
            <Shield className="h-5 w-5 text-green-500" />
        );
    };

    const renderSensitiveField = (
        value: string | undefined,
        fieldName: string,
        label: string,
        isMultiline = false
    ) => {
        if (!value) return null;

        const isVisible = showSensitive[fieldName];

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {label}
                    </label>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleSensitiveVisibility(fieldName)}
                        >
                            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(value, label)}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className={`p-3 rounded-md bg-gray-800 dark:bg-gray-800 ${isMultiline ? '' : 'min-h-[2.5rem]'}`}>
                    {isVisible ? (
                        <pre className={`text-sm ${isMultiline ? 'whitespace-pre-wrap' : 'whitespace-nowrap'} font-mono`}>
                            {value}
                        </pre>
                    ) : (
                        <div className="text-sm text-gray-500">
                            {'•'.repeat(isMultiline ? 50 : 20)}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    if (loading || !credentialDetails) {
        return (
            <Sheet open={true} onOpenChange={onClose}>
                <SheetContent className="w-[800px] max-w-[90vw]">
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Sheet open={true} onOpenChange={onClose}>
            <SheetContent className="w-[800px] max-w-[90vw] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center space-x-3">
                        {getAuthIcon(credentialDetails.authType)}
                        <div>
                            <div>{credentialDetails.name}</div>
                            <div className="text-sm font-normal text-gray-600 dark:text-gray-400">
                                {credentialDetails.description}
                            </div>
                        </div>
                        <div className="flex items-center space-x-2 ml-auto">
                            <Badge variant={credentialDetails.authType === 'password' ? 'secondary' : 'outline'}>
                                {credentialDetails.authType}
                            </Badge>
                            {credentialDetails.keyType && (
                                <Badge variant="outline">{credentialDetails.keyType}</Badge>
                            )}
                        </div>
                    </SheetTitle>
                </SheetHeader>

                <div className="space-y-6">
                    {/* Tab Navigation */}
                    <div className="flex space-x-1 p-1 bg-[#18181b] border-2 border-[#303032] rounded-lg">
                        <Button
                            variant={activeTab === 'overview' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('overview')}
                            className="flex-1"
                        >
                            <FileText className="h-4 w-4 mr-2" />
                            {t('credentials.overview')}
                        </Button>
                        <Button
                            variant={activeTab === 'security' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('security')}
                            className="flex-1"
                        >
                            <Shield className="h-4 w-4 mr-2" />
                            {t('credentials.security')}
                        </Button>
                        <Button
                            variant={activeTab === 'usage' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setActiveTab('usage')}
                            className="flex-1"
                        >
                            <Server className="h-4 w-4 mr-2" />
                            {t('credentials.usage')}
                        </Button>
                    </div>

                    {/* Tab Content */}
                    {activeTab === 'overview' && (
                        <div className="grid gap-6 md:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">{t('credentials.basicInformation')}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center space-x-3">
                                        <User className="h-4 w-4 text-gray-500" />
                                        <div>
                                            <div className="text-sm text-gray-500">{t('common.username')}</div>
                                            <div className="font-medium">{credentialDetails.username}</div>
                                        </div>
                                    </div>

                                    {credentialDetails.folder && (
                                        <div className="flex items-center space-x-3">
                                            <Folder className="h-4 w-4 text-gray-500" />
                                            <div>
                                                <div className="text-sm text-gray-500">{t('common.folder')}</div>
                                                <div className="font-medium">{credentialDetails.folder}</div>
                                            </div>
                                        </div>
                                    )}

                                    {credentialDetails.tags.length > 0 && (
                                        <div className="flex items-start space-x-3">
                                            <Hash className="h-4 w-4 text-gray-500 mt-1" />
                                            <div className="flex-1">
                                                <div className="text-sm text-gray-500 mb-2">{t('hosts.tags')}</div>
                                                <div className="flex flex-wrap gap-1">
                                                    {credentialDetails.tags.map((tag, index) => (
                                                        <Badge key={index} variant="outline" className="text-xs">
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <Separator />

                                    <div className="flex items-center space-x-3">
                                        <Calendar className="h-4 w-4 text-gray-500" />
                                        <div>
                                            <div className="text-sm text-gray-500">{t('credentials.created')}</div>
                                            <div className="font-medium">{formatDate(credentialDetails.createdAt)}</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center space-x-3">
                                        <Calendar className="h-4 w-4 text-gray-500" />
                                        <div>
                                            <div className="text-sm text-gray-500">{t('credentials.lastModified')}</div>
                                            <div className="font-medium">{formatDate(credentialDetails.updatedAt)}</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">{t('credentials.usageStatistics')}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="text-center p-4 bg-blue-900/20 dark:bg-blue-900/20 rounded-lg">
                                        <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                                            {credentialDetails.usageCount}
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            {t('credentials.timesUsed')}
                                        </div>
                                    </div>

                                    {credentialDetails.lastUsed && (
                                        <div className="flex items-center space-x-3 p-3 bg-green-900/20 dark:bg-green-900/20 rounded-lg">
                                            <Clock className="h-5 w-5 text-green-600 dark:text-green-400" />
                                            <div>
                                                <div className="text-sm text-gray-500">{t('credentials.lastUsed')}</div>
                                                <div className="font-medium">{formatDate(credentialDetails.lastUsed)}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center space-x-3 p-3 bg-purple-900/20 dark:bg-purple-900/20 rounded-lg">
                                        <Server className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                        <div>
                                            <div className="text-sm text-gray-500">{t('credentials.connectedHosts')}</div>
                                            <div className="font-medium">{hostsUsing.length}</div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center space-x-2">
                                    <Shield className="h-5 w-5 text-green-600" />
                                    <span>{t('credentials.securityDetails')}</span>
                                </CardTitle>
                                <CardDescription>
                                    {t('credentials.securityDetailsDescription')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex items-center space-x-3 p-4 bg-green-900/20 dark:bg-green-900/20 rounded-lg">
                                    <CheckCircle className="h-6 w-6 text-green-600" />
                                    <div>
                                        <div className="font-medium text-green-800 dark:text-green-200">
                                            {t('credentials.credentialSecured')}
                                        </div>
                                        <div className="text-sm text-green-700 dark:text-green-300">
                                            {t('credentials.credentialSecuredDescription')}
                                        </div>
                                    </div>
                                </div>

                                {credentialDetails.authType === 'password' && (
                                    <div>
                                        <h3 className="font-semibold mb-3">{t('credentials.passwordAuthentication')}</h3>
                                        {renderSensitiveField(credentialDetails.password, 'password', t('common.password'))}
                                    </div>
                                )}

                                {credentialDetails.authType === 'key' && (
                                    <div className="space-y-4">
                                        <h3 className="font-semibold">{t('credentials.keyAuthentication')}</h3>
                                        
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div>
                                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                    {t('credentials.keyType')}
                                                </div>
                                                <Badge variant="outline" className="text-sm">
                                                    {credentialDetails.keyType?.toUpperCase() || t('unknown').toUpperCase()}
                                                </Badge>
                                            </div>
                                        </div>

                                        {renderSensitiveField(credentialDetails.key, 'key', t('credentials.privateKey'), true)}
                                        
                                        {credentialDetails.keyPassword && renderSensitiveField(
                                            credentialDetails.keyPassword, 
                                            'keyPassword', 
                                            t('credentials.keyPassphrase')
                                        )}
                                    </div>
                                )}

                                <div className="flex items-start space-x-3 p-4 bg-amber-900/20 dark:bg-amber-900/20 rounded-lg">
                                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                                    <div className="text-sm">
                                        <div className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                                            {t('credentials.securityReminder')}
                                        </div>
                                        <div className="text-amber-700 dark:text-amber-300">
                                            {t('credentials.securityReminderText')}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {activeTab === 'usage' && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center space-x-2">
                                    <Server className="h-5 w-5 text-blue-600" />
                                    <span>{t('credentials.hostsUsingCredential')}</span>
                                    <Badge variant="secondary">{hostsUsing.length}</Badge>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {hostsUsing.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500">
                                        <Server className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                                        <p>{t('credentials.noHostsUsingCredential')}</p>
                                    </div>
                                ) : (
                                    <ScrollArea className="h-64">
                                        <div className="space-y-3">
                                            {hostsUsing.map((host) => (
                                                <div 
                                                    key={host.id} 
                                                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-800 dark:hover:bg-gray-700"
                                                >
                                                    <div className="flex items-center space-x-3">
                                                        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded">
                                                            <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium">
                                                                {host.name || `${host.ip}:${host.port}`}
                                                            </div>
                                                            <div className="text-sm text-gray-500">
                                                                {host.ip}:{host.port}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right text-sm text-gray-500">
                                                        {formatDate(host.createdAt)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                <SheetFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('common.close')}
                    </Button>
                    <Button onClick={onEdit}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        {t('credentials.editCredential')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
};

export default CredentialViewer;