import React from "react";
import {useSidebar} from "@/components/ui/sidebar";
import {Separator} from "@/components/ui/separator.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert.tsx";
import {Checkbox} from "@/components/ui/checkbox.tsx";
import {Input} from "@/components/ui/input.tsx";
import {Label} from "@/components/ui/label.tsx";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table.tsx";
// 🎯 Import the Eye and EyeOff icons from lucide-react
import {Shield, Trash2, Users, Eye, EyeOff} from "lucide-react";
import {toast} from "sonner";
import {useTranslation} from "react-i18next";
import {
    getOIDCConfig,
    getRegistrationAllowed,
    getUserList,
    updateRegistrationAllowed,
    updateOIDCConfig,
    makeUserAdmin,
    removeAdminStatus,
    deleteUser
} from "@/ui/main-axios.ts";

function getCookie(name: string) {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r;
    }, "");
}

interface AdminSettingsProps {
    isTopbarOpen?: boolean;
}

export function AdminSettings({isTopbarOpen = true}: AdminSettingsProps): React.ReactElement {
    const {t} = useTranslation();
    const {state: sidebarState} = useSidebar();

    const [allowRegistration, setAllowRegistration] = React.useState(true);
    const [regLoading, setRegLoading] = React.useState(false);

    // 🎯 New state to manage password visibility
    const [showClientSecret, setShowClientSecret] = React.useState(false);

    const [oidcConfig, setOidcConfig] = React.useState({
        client_id: '',
        client_secret: '',
        issuer_url: '',
        authorization_url: '',
        token_url: '',
        identifier_path: 'sub',
        name_path: 'name',
        scopes: 'openid email profile',
        userinfo_url: ''
    });
    const [oidcLoading, setOidcLoading] = React.useState(false);
    const [oidcError, setOidcError] = React.useState<string | null>(null);

    const [users, setUsers] = React.useState<Array<{
        id: string;
        username: string;
        is_admin: boolean;
        is_oidc: boolean
    }>>([]);
    const [usersLoading, setUsersLoading] = React.useState(false);
    const [newAdminUsername, setNewAdminUsername] = React.useState("");
    const [makeAdminLoading, setMakeAdminLoading] = React.useState(false);
    const [makeAdminError, setMakeAdminError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const jwt = getCookie("jwt");
        if (!jwt) return;
        getOIDCConfig()
            .then(res => {
                if (res) setOidcConfig(res);
            })
            .catch(() => {
            });
        fetchUsers();
    }, []);

    React.useEffect(() => {
        getRegistrationAllowed()
            .then(res => {
                if (typeof res?.allowed === 'boolean') {
                    setAllowRegistration(res.allowed);
                }
            })
            .catch(() => {
            });
    }, []);

    const fetchUsers = async () => {
        const jwt = getCookie("jwt");
        if (!jwt) return;
        setUsersLoading(true);
        try {
            const response = await getUserList();
            setUsers(response.users);
        } finally {
            setUsersLoading(false);
        }
    };

    const handleToggleRegistration = async (checked: boolean) => {
        setRegLoading(true);
        const jwt = getCookie("jwt");
        try {
            await updateRegistrationAllowed(checked);
            setAllowRegistration(checked);
        } finally {
            setRegLoading(false);
        }
    };

    const handleOIDCConfigSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setOidcLoading(true);
        setOidcError(null);

        const required = ['client_id', 'client_secret', 'issuer_url', 'authorization_url', 'token_url'];
        const missing = required.filter(f => !oidcConfig[f as keyof typeof oidcConfig]);
        if (missing.length > 0) {
            setOidcError(t('admin.missingRequiredFields', { fields: missing.join(', ') }));
            setOidcLoading(false);
            return;
        }

        const jwt = getCookie("jwt");
        try {
            await updateOIDCConfig(oidcConfig);
            toast.success(t('admin.oidcConfigurationUpdated'));
        } catch (err: any) {
            setOidcError(err?.response?.data?.error || t('admin.failedToUpdateOidcConfig'));
        } finally {
            setOidcLoading(false);
        }
    };

    const handleOIDCConfigChange = (field: string, value: string) => {
        setOidcConfig(prev => ({...prev, [field]: value}));
    };

    const handleMakeUserAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAdminUsername.trim()) return;
        setMakeAdminLoading(true);
        setMakeAdminError(null);
        const jwt = getCookie("jwt");
        try {
            await makeUserAdmin(newAdminUsername.trim());
            toast.success(t('admin.userIsNowAdmin', { username: newAdminUsername }));
            setNewAdminUsername("");
            fetchUsers();
        } catch (err: any) {
            setMakeAdminError(err?.response?.data?.error || t('admin.failedToMakeUserAdmin'));
        } finally {
            setMakeAdminLoading(false);
        }
    };

    const handleRemoveAdminStatus = async (username: string) => {
        if (!confirm(t('admin.removeAdminStatus', { username }))) return;
        const jwt = getCookie("jwt");
        try {
            await removeAdminStatus(username);
            toast.success(t('admin.adminStatusRemoved', { username }));
            fetchUsers();
        } catch (err: any) {
            console.error('Failed to remove admin status:', err);
            toast.error(t('admin.failedToRemoveAdminStatus'));
        }
    };

    const handleDeleteUser = async (username: string) => {
        if (!confirm(t('admin.deleteUser', { username }))) return;
        const jwt = getCookie("jwt");
        try {
            await deleteUser(username);
            toast.success(t('admin.userDeletedSuccessfully', { username }));
            fetchUsers();
        } catch (err: any) {
            console.error('Failed to delete user:', err);
            toast.error(t('admin.failedToDeleteUser'));
        }
    };

    const topMarginPx = isTopbarOpen ? 74 : 26;
    const leftMarginPx = sidebarState === 'collapsed' ? 26 : 8;
    const bottomMarginPx = 8;
    const wrapperStyle: React.CSSProperties = {
        marginLeft: leftMarginPx,
        marginRight: 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`
    };

    return (
        <div style={wrapperStyle}
             className="bg-[#18181b] text-white rounded-lg border-2 border-[#303032] overflow-hidden">
            <div className="h-full w-full flex flex-col">
                <div className="flex items-center justify-between px-3 pt-2 pb-2">
                    <h1 className="font-bold text-lg">{t('admin.title')}</h1>
                </div>
                <Separator className="p-0.25 w-full"/>

                <div className="px-6 py-4 overflow-auto">
                    <Tabs defaultValue="registration" className="w-full">
                        <TabsList className="mb-4 bg-[#18181b] border-2 border-[#303032]">
                            <TabsTrigger value="registration" className="flex items-center gap-2">
                                <Users className="h-4 w-4"/>
                                {t('admin.general')}
                            </TabsTrigger>
                            <TabsTrigger value="oidc" className="flex items-center gap-2">
                                <Shield className="h-4 w-4"/>
                                OIDC
                            </TabsTrigger>
                            <TabsTrigger value="users" className="flex items-center gap-2">
                                <Users className="h-4 w-4"/>
                                {t('admin.users')}
                            </TabsTrigger>
                            <TabsTrigger value="admins" className="flex items-center gap-2">
                                <Shield className="h-4 w-4"/>
                                {t('admin.adminManagement')}
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="registration" className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold">{t('admin.userRegistration')}</h3>
                                <label className="flex items-center gap-2">
                                    <Checkbox checked={allowRegistration} onCheckedChange={handleToggleRegistration}
                                              disabled={regLoading}/>
                                    {t('admin.allowNewAccountRegistration')}
                                </label>
                            </div>
                        </TabsContent>

                        <TabsContent value="oidc" className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold">{t('admin.externalAuthentication')}</h3>
                                <p className="text-sm text-muted-foreground">{t('admin.configureExternalProvider')}</p>

                                {oidcError && (
                                    <Alert variant="destructive">
                                        <AlertTitle>{t('common.error')}</AlertTitle>
                                        <AlertDescription>{oidcError}</AlertDescription>
                                    </Alert>
                                )}

                                <form onSubmit={handleOIDCConfigSubmit} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="client_id">{t('admin.clientId')}</Label>
                                        <Input id="client_id" value={oidcConfig.client_id}
                                               onChange={(e) => handleOIDCConfigChange('client_id', e.target.value)}
                                               placeholder={t('placeholders.clientId')} required/>
                                    </div>
                                    {/* 🎯 Updated block for client_secret input */}
                                    <div className="space-y-2">
                                        <Label htmlFor="client_secret">{t('admin.clientSecret')}</Label>
                                         <div className="relative">
                                             <Input
                                                id="client_secret"
                                                // 🎯 Set input type based on showClientSecret state
                                                type={showClientSecret ? "text" : "password"}
                                                value={oidcConfig.client_secret}
                                                onChange={(e) => handleOIDCConfigChange('client_secret', e.target.value)}
                                                placeholder={t('placeholders.clientSecret')}
                                                required
                                                // 🎯 Add padding to the right for the button
                                                className="pr-10"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                // 🎯 Toggle the state on click
                                                onClick={() => setShowClientSecret((prev) => !prev)}
                                                className="absolute right-0 top-0 h-full px-3 py-2"
                                            >
                                                {/* 🎯 Conditionally render the correct icon */}
                                                {showClientSecret ? (
                                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    {/* 🎯 End of updated block */}
                                    <div className="space-y-2">
                                        <Label htmlFor="authorization_url">{t('admin.authorizationUrl')}</Label>
                                        <Input id="authorization_url" value={oidcConfig.authorization_url}
                                               onChange={(e) => handleOIDCConfigChange('authorization_url', e.target.value)}
                                               placeholder={t('placeholders.authUrl')}
                                               required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="issuer_url">{t('admin.issuerUrl')}</Label>
                                        <Input id="issuer_url" value={oidcConfig.issuer_url}
                                               onChange={(e) => handleOIDCConfigChange('issuer_url', e.target.value)}
                                               placeholder={t('placeholders.redirectUrl')} required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="token_url">{t('admin.tokenUrl')}</Label>
                                        <Input id="token_url" value={oidcConfig.token_url}
                                               onChange={(e) => handleOIDCConfigChange('token_url', e.target.value)}
                                               placeholder={t('placeholders.tokenUrl')} required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="identifier_path">{t('admin.userIdentifierPath')}</Label>
                                        <Input id="identifier_path" value={oidcConfig.identifier_path}
                                               onChange={(e) => handleOIDCConfigChange('identifier_path', e.target.value)}
                                               placeholder={t('placeholders.userIdField')} required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="name_path">{t('admin.displayNamePath')}</Label>
                                        <Input id="name_path" value={oidcConfig.name_path}
                                               onChange={(e) => handleOIDCConfigChange('name_path', e.target.value)}
                                               placeholder={t('placeholders.usernameField')} required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="scopes">{t('admin.scopes')}</Label>
                                        <Input id="scopes" value={oidcConfig.scopes}
                                               onChange={(e) => handleOIDCConfigChange('scopes', e.target.value)}
                                               placeholder={t('placeholders.scopes')} required/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="userinfo_url">{t('admin.overrideUserInfoUrl')}</Label>
                                        <Input id="userinfo_url" value={oidcConfig.userinfo_url}
                                               onChange={(e) => handleOIDCConfigChange('userinfo_url', e.target.value)}
                                               placeholder="https://your-provider.com/application/o/userinfo/"/>
                                    </div>
                                    <div className="flex gap-2 pt-2">
                                        <Button type="submit" className="flex-1"
                                                disabled={oidcLoading}>{oidcLoading ? t('admin.saving') : t('admin.saveConfiguration')}</Button>
                                        <Button type="button" variant="outline" onClick={() => setOidcConfig({
                                            client_id: '',
                                            client_secret: '',
                                            issuer_url: '',
                                            authorization_url: '',
                                            token_url: '',
                                            identifier_path: 'sub',
                                            name_path: 'name',
                                            scopes: 'openid email profile',
                                            userinfo_url: ''
                                        })}>{t('admin.reset')}</Button>
                                    </div>
                                </form>
                            </div>
                        </TabsContent>

                        <TabsContent value="users" className="space-y-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold">{t('admin.userManagement')}</h3>
                                    <Button onClick={fetchUsers} disabled={usersLoading} variant="outline"
                                            size="sm">{usersLoading ? t('admin.loading') : t('admin.refresh')}</Button>
                                </div>
                                {usersLoading ? (
                                    <div className="text-center py-8 text-muted-foreground">{t('admin.loadingUsers')}</div>
                                ) : (
                                    <div className="border rounded-md overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="px-4">{t('admin.username')}</TableHead>
                                                    <TableHead className="px-4">{t('admin.type')}</TableHead>
                                                    <TableHead className="px-4">{t('admin.actions')}</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {users.map((user) => (
                                                    <TableRow key={user.id}>
                                                        <TableCell className="px-4 font-medium">
                                                            {user.username}
                                                            {user.is_admin && (
                                                                <span
                                                                    className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">{t('admin.adminBadge')}</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell
                                                            className="px-4">{user.is_oidc ? t('admin.external') : t('admin.local')}</TableCell>
                                                        <TableCell className="px-4">
                                                            <Button variant="ghost" size="sm"
                                                                    onClick={() => handleDeleteUser(user.username)}
                                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                                    disabled={user.is_admin}>
                                                                <Trash2 className="h-4 w-4"/>
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="admins" className="space-y-6">
                            <div className="space-y-6">
                                <h3 className="text-lg font-semibold">{t('admin.adminManagement')}</h3>
                                <div className="space-y-4 p-6 border rounded-md bg-muted/50">
                                    <h4 className="font-medium">{t('admin.makeUserAdmin')}</h4>
                                    <form onSubmit={handleMakeUserAdmin} className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="new-admin-username">{t('admin.username')}</Label>
                                            <div className="flex gap-2">
                                                <Input id="new-admin-username" value={newAdminUsername}
                                                       onChange={(e) => setNewAdminUsername(e.target.value)}
                                                       placeholder={t('admin.enterUsernameToMakeAdmin')} required/>
                                                <Button type="submit"
                                                        disabled={makeAdminLoading || !newAdminUsername.trim()}>{makeAdminLoading ? t('admin.adding') : t('admin.makeAdmin')}</Button>
                                            </div>
                                        </div>
                                        {makeAdminError && (
                                            <Alert variant="destructive">
                                                <AlertTitle>{t('common.error')}</AlertTitle>
                                                <AlertDescription>{makeAdminError}</AlertDescription>
                                            </Alert>
                                        )}

                                    </form>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="font-medium">{t('admin.currentAdmins')}</h4>
                                    <div className="border rounded-md overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="px-4">{t('admin.username')}</TableHead>
                                                    <TableHead className="px-4">{t('admin.type')}</TableHead>
                                                    <TableHead className="px-4">{t('admin.actions')}</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {users.filter(u => u.is_admin).map((admin) => (
                                                    <TableRow key={admin.id}>
                                                        <TableCell className="px-4 font-medium">
                                                            {admin.username}
                                                            <span
                                                                className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">{t('admin.adminBadge')}</span>
                                                        </TableCell>
                                                        <TableCell
                                                            className="px-4">{admin.is_oidc ? t('admin.external') : t('admin.local')}</TableCell>
                                                        <TableCell className="px-4">
                                                            <Button variant="ghost" size="sm"
                                                                    onClick={() => handleRemoveAdminStatus(admin.username)}
                                                                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50">
                                                                <Shield className="h-4 w-4"/>
                                                                {t('admin.removeAdminButton')}
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}

export default AdminSettings;