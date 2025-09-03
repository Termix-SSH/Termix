import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card.tsx";
import {Key} from "lucide-react";
import React, {useState} from "react";
import {completePasswordReset, initiatePasswordReset, verifyPasswordResetCode} from "@/ui/main-axios.ts";
import {Label} from "@/components/ui/label.tsx";
import {Input} from "@/components/ui/input.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert.tsx";
import {toast} from "sonner";

interface PasswordResetProps {
    userInfo: {
        username: string;
        is_admin: boolean;
        is_oidc: boolean;
        totp_enabled: boolean;
    }
}

export function PasswordReset({userInfo}: PasswordResetProps) {
    const [error, setError] = useState<string | null>(null);

    const [resetStep, setResetStep] = useState<"initiate" | "verify" | "newPassword">("initiate");
    const [resetCode, setResetCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [tempToken, setTempToken] = useState("");
    const [resetLoading, setResetLoading] = useState(false);

    async function handleInitiatePasswordReset() {
        setError(null);
        setResetLoading(true);
        try {
            const result = await initiatePasswordReset(userInfo.username);
            setResetStep("verify");
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.error || err?.message || "Failed to initiate password reset");
        } finally {
            setResetLoading(false);
        }
    }

    function resetPasswordState() {
        setResetStep("initiate");
        setResetCode("");
        setNewPassword("");
        setConfirmPassword("");
        setTempToken("");
        setError(null);
    }

    async function handleVerifyResetCode() {
        setError(null);
        setResetLoading(true);
        try {
            const response = await verifyPasswordResetCode(userInfo.username, resetCode);
            setTempToken(response.tempToken);
            setResetStep("newPassword");
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.error || "Failed to verify reset code");
        } finally {
            setResetLoading(false);
        }
    }

    async function handleCompletePasswordReset() {
        setError(null);
        setResetLoading(true);

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match");
            setResetLoading(false);
            return;
        }

        if (newPassword.length < 6) {
            setError("Password must be at least 6 characters long");
            setResetLoading(false);
            return;
        }

        try {
            await completePasswordReset(userInfo.username, tempToken, newPassword);

            toast.success("Password reset successfully! You can now log in with your new password.");
            resetPasswordState();
        } catch (err: any) {
            setError(err?.response?.data?.error || "Failed to complete password reset");
        } finally {
            setResetLoading(false);
        }
    }

    const Spinner = (
        <svg className="animate-spin mr-2 h-4 w-4 text-white inline-block" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
        </svg>
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5"/>
                    Password
                </CardTitle>
                <CardDescription>
                    Change your account password
                </CardDescription>
            </CardHeader>
            <CardContent>
                <>
                    {resetStep === "initiate" && (
                        <>
                            <div className="flex flex-col gap-4">
                                <Button
                                    type="button"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={resetLoading || !userInfo.username.trim()}
                                    onClick={handleInitiatePasswordReset}
                                >
                                    {resetLoading ? Spinner : "Send Reset Code"}
                                </Button>
                            </div>
                        </>
                    )}

                    {resetStep === "verify" && (
                        <>
                            <div className="text-center text-muted-foreground mb-4">
                                <p>Enter the 6-digit code from the docker container logs for
                                    user: <strong>{userInfo.username}</strong></p>
                            </div>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="reset-code">Reset Code</Label>
                                    <Input
                                        id="reset-code"
                                        type="text"
                                        required
                                        maxLength={6}
                                        className="h-11 text-base text-center text-lg tracking-widest"
                                        value={resetCode}
                                        onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))}
                                        disabled={resetLoading}
                                        placeholder="000000"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={resetLoading || resetCode.length !== 6}
                                    onClick={handleVerifyResetCode}
                                >
                                    {resetLoading ? Spinner : "Verify Code"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={resetLoading}
                                    onClick={() => {
                                        setResetStep("initiate");
                                        setResetCode("");
                                    }}
                                >
                                    Back
                                </Button>
                            </div>
                        </>
                    )}

                    {resetStep === "newPassword" && (
                        <>
                            <div className="text-center text-muted-foreground mb-4">
                                <p>Enter your new password for
                                    user: <strong>{userInfo.username}</strong></p>
                            </div>
                            <div className="flex flex-col gap-5">
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="new-password">New Password</Label>
                                    <Input
                                        id="new-password"
                                        type="password"
                                        required
                                        className="h-11 text-base focus:ring-2 focus:ring-primary/50 transition-all duration-200"
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        disabled={resetLoading}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="confirm-password">Confirm Password</Label>
                                    <Input
                                        id="confirm-password"
                                        type="password"
                                        required
                                        className="h-11 text-base focus:ring-2 focus:ring-primary/50 transition-all duration-200"
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        disabled={resetLoading}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={resetLoading || !newPassword || !confirmPassword}
                                    onClick={handleCompletePasswordReset}
                                >
                                    {resetLoading ? Spinner : "Reset Password"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-11 text-base font-semibold"
                                    disabled={resetLoading}
                                    onClick={() => {
                                        setResetStep("verify");
                                        setNewPassword("");
                                        setConfirmPassword("");
                                    }}
                                >
                                    Back
                                </Button>
                            </div>
                        </>
                    )}
                    {error && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </>
            </CardContent>
        </Card>
    )
}