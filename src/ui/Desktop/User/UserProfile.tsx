import React, {useState, useEffect} from "react";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Input} from "@/components/ui/input.tsx";
import {Label} from "@/components/ui/label.tsx";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert.tsx";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import {Separator} from "@/components/ui/separator.tsx";
import {User, Shield, Key, AlertCircle} from "lucide-react";
import {TOTPSetup} from "@/ui/Desktop/User/TOTPSetup.tsx";
import {getUserInfo} from "@/ui/main-axios.ts";
import {getVersionInfo} from "@/ui/main-axios.ts";
import {toast} from "sonner";
import {PasswordReset} from "@/ui/Desktop/User/PasswordReset.tsx";
import {useTranslation} from "react-i18next";
import {LanguageSwitcher} from "@/ui/Desktop/User/LanguageSwitcher.tsx";
import {useSidebar} from "@/components/ui/sidebar.tsx";


interface UserProfileProps {
    isTopbarOpen?: boolean;
}

export function UserProfile({isTopbarOpen = true}: UserProfileProps) {
    const {t} = useTranslation();
    const {state: sidebarState} = useSidebar();
    const [userInfo, setUserInfo] = useState<{
        username: string;
        is_admin: boolean;
        is_oidc: boolean;
        totp_enabled: boolean;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [versionInfo, setVersionInfo] = useState<{ version: string } | null>(null);


    useEffect(() => {
        fetchUserInfo();
        fetchVersion();
    }, []);

    const fetchVersion = async () => {
        try {
            const info = await getVersionInfo();
            setVersionInfo({version: info.localVersion});
        } catch (err) {
            console.error("Failed to load version info", err);
            const {toast} = await import('sonner');
            toast.error(t('user.failedToLoadVersionInfo'));
        }
    };

    const fetchUserInfo = async () => {
        setLoading(true);
        setError(null);
        try {
            const info = await getUserInfo();
            setUserInfo({
                username: info.username,
                is_admin: info.is_admin,
                is_oidc: info.is_oidc,
                totp_enabled: info.totp_enabled || false
            });
        } catch (err: any) {
            setError(err?.response?.data?.error || t('errors.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleTOTPStatusChange = (enabled: boolean) => {
        if (userInfo) {
            setUserInfo({...userInfo, totp_enabled: enabled});
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

    if (loading) {
        return (
            <div style={wrapperStyle} className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden">
                <div className="h-full w-full flex flex-col">
                    <div className="flex items-center justify-between px-3 pt-2 pb-2">
                        <h1 className="font-bold text-lg">{t('nav.userProfile')}</h1>
                    </div>
                    <Separator className="p-0.25 w-full"/>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="animate-pulse text-gray-300">{t('common.loading')}</div>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !userInfo) {
        return (
            <div style={wrapperStyle} className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden">
                <div className="h-full w-full flex flex-col">
                    <div className="flex items-center justify-between px-3 pt-2 pb-2">
                        <h1 className="font-bold text-lg">{t('nav.userProfile')}</h1>
                    </div>
                    <Separator className="p-0.25 w-full"/>
                    <div className="flex-1 flex items-center justify-center p-6">
                        <Alert variant="destructive" className="bg-red-900/20 border-red-500/50">
                            <AlertCircle className="h-4 w-4"/>
                            <AlertTitle className="text-red-400">{t('common.error')}</AlertTitle>
                            <AlertDescription className="text-red-300">{error || t('errors.loadFailed')}</AlertDescription>
                        </Alert>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={wrapperStyle} className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden">
            <div className="h-full w-full flex flex-col">
                <div className="flex items-center justify-between px-3 pt-2 pb-2">
                    <h1 className="font-bold text-lg">{t('nav.userProfile')}</h1>
                </div>
                <Separator className="p-0.25 w-full"/>

                <div className="px-6 py-4 overflow-auto flex-1">
                    <Tabs defaultValue="profile" className="w-full">
                        <TabsList className="mb-4 bg-dark-bg border-2 border-dark-border">
                            <TabsTrigger value="profile" className="flex items-center gap-2 data-[state=active]:bg-dark-bg-button">
                                <User className="w-4 h-4"/>
                                {t('nav.userProfile')}
                            </TabsTrigger>
                            {!userInfo.is_oidc && (
                                <TabsTrigger value="security" className="flex items-center gap-2 data-[state=active]:bg-dark-bg-button">
                                    <Shield className="w-4 h-4"/>
                                    {t('profile.security')}
                                </TabsTrigger>
                            )}
                        </TabsList>

                        <TabsContent value="profile" className="space-y-4">
                            <div className="rounded-lg border-2 border-dark-border bg-dark-bg-darker p-4">
                                <h3 className="text-lg font-semibold mb-4">{t('profile.accountInfo')}</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-gray-300">{t('common.username')}</Label>
                                        <p className="text-lg font-medium mt-1 text-white">{userInfo.username}</p>
                                    </div>
                                    <div>
                                        <Label className="text-gray-300">{t('profile.role')}</Label>
                                        <p className="text-lg font-medium mt-1 text-white">
                                            {userInfo.is_admin ? t('interface.administrator') : t('interface.user')}
                                        </p>
                                    </div>
                                    <div>
                                        <Label className="text-gray-300">{t('profile.authMethod')}</Label>
                                        <p className="text-lg font-medium mt-1 text-white">
                                            {userInfo.is_oidc ? t('profile.external') : t('profile.local')}
                                        </p>
                                    </div>
                                    <div>
                                        <Label className="text-gray-300">{t('profile.twoFactorAuth')}</Label>
                                        <p className="text-lg font-medium mt-1">
                                            {userInfo.is_oidc ? (
                                                <span className="text-gray-400">{t('auth.lockedOidcAuth')}</span>
                                            ) : (
                                                userInfo.totp_enabled ? (
                                                    <span className="text-green-400 flex items-center gap-1">
                                                        <Shield className="w-4 h-4"/>
                                                        {t('common.enabled')}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">{t('common.disabled')}</span>
                                                )
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <Label className="text-gray-300">{t('common.version')}</Label>
                                        <p className="text-lg font-medium mt-1 text-white">
                                            {versionInfo?.version || t('common.loading')}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-6 pt-6 border-t border-dark-border">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label className="text-gray-300">{t('common.language')}</Label>
                                            <p className="text-sm text-gray-400 mt-1">{t('profile.selectPreferredLanguage')}</p>
                                        </div>
                                        <LanguageSwitcher/>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="security" className="space-y-4">
                            <TOTPSetup
                                isEnabled={userInfo.totp_enabled}
                                onStatusChange={handleTOTPStatusChange}
                            />

                            {!userInfo.is_oidc && (
                                <PasswordReset
                                    userInfo={userInfo}
                                />
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}