import React, {useState, useEffect} from "react";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Input} from "@/components/ui/input.tsx";
import {Label} from "@/components/ui/label.tsx";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert.tsx";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import {User, Shield, Key, AlertCircle} from "lucide-react";
import {TOTPSetup} from "@/ui/Desktop/User/TOTPSetup.tsx";
import {getUserInfo} from "@/ui/main-axios.ts";
import { getVersionInfo } from "@/ui/main-axios.ts";
import {toast} from "sonner";
import {PasswordReset} from "@/ui/Desktop/User/PasswordReset.tsx";
import {useTranslation} from "react-i18next";
import {LanguageSwitcher} from "@/components/LanguageSwitcher.tsx";


interface UserProfileProps {
    isTopbarOpen?: boolean;
}

export function UserProfile({isTopbarOpen = true}: UserProfileProps) {
    const {t} = useTranslation();
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
                setVersionInfo({ version: info.version });
            } catch (err) {
                console.error("Failed to load version info", err);
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

    if (loading) {
        return (
            <div className="container max-w-4xl mx-auto p-6">
                <Card>
                    <CardContent className="p-12 text-center">
                        <div className="animate-pulse">{t('common.loading')}</div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (error || !userInfo) {
        return (
            <div className="container max-w-4xl mx-auto p-6">
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4"/>
                    <AlertTitle>{t('common.error')}</AlertTitle>
                    <AlertDescription>{error || t('errors.loadFailed')}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="container max-w-4xl mx-auto p-6 overflow-y-auto" style={{
            marginTop: isTopbarOpen ? '60px' : '0',
            transition: 'margin-top 0.3s ease',
            maxHeight: 'calc(100vh - 60px)'
        }}>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">{t('common.profile')}</h1>
                <p className="text-muted-foreground mt-2">{t('profile.description')}</p>
            </div>

            <Tabs defaultValue="profile" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="profile" className="flex items-center gap-2">
                        <User className="w-4 h-4"/>
                        {t('common.profile')}
                    </TabsTrigger>
                    {!userInfo.is_oidc && (
                        <TabsTrigger value="security" className="flex items-center gap-2">
                            <Shield className="w-4 h-4"/>
                            {t('profile.security')}
                        </TabsTrigger>
                    )}
                </TabsList>

                <TabsContent value="profile" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('profile.accountInfo')}</CardTitle>
                            <CardDescription>{t('profile.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>{t('common.username')}</Label>
                                    <p className="text-lg font-medium mt-1">{userInfo.username}</p>
                                </div>
                                <div>
                                    <Label>{t('profile.role')}</Label>
                                    <p className="text-lg font-medium mt-1">
                                        {userInfo.is_admin ? t('interface.administrator') : t('interface.user')}
                                    </p>
                                </div>
                                <div>
                                    <Label>{t('profile.authMethod')}</Label>
                                    <p className="text-lg font-medium mt-1">
                                        {userInfo.is_oidc ? t('profile.external') : t('profile.local')}
                                    </p>
                                </div>
                                <div>
                                    <Label>{t('profile.twoFactorAuth')}</Label>
                                    <p className="text-lg font-medium mt-1">
                                        {userInfo.is_oidc ? (
                                            <span className="text-muted-foreground">{t('auth.lockedOidcAuth')}</span>
                                        ) : (
                                            userInfo.totp_enabled ? (
                                                <span className="text-green-600 flex items-center gap-1">
                                                    <Shield className="w-4 h-4"/>
                                                    {t('common.enabled')}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">{t('common.disabled')}</span>
                                            )
                                        )}
                                    </p>
                                </div>
                               <div>
                                <Label>{t('common.version')}</Label>
                                <p className="text-lg font-medium mt-1">
                                    {versionInfo?.version || t('common.loading')}
                                </p>
                                </div>

                            </div>
                            
                            <div className="mt-6 pt-6 border-t">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label>{t('common.language')}</Label>
                                        <p className="text-sm text-muted-foreground mt-1">{t('profile.selectPreferredLanguage')}</p>
                                    </div>
                                    <LanguageSwitcher />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
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
    );
}