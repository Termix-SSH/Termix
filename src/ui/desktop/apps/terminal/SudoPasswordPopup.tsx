import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

interface SudoPasswordPopupProps {
    isOpen: boolean;
    hostPassword: string;
    backgroundColor: string;
    onConfirm: (password: string) => void;
    onDismiss: () => void;
}

export function SudoPasswordPopup({
    isOpen,
    hostPassword,
    backgroundColor,
    onConfirm,
    onDismiss
}: SudoPasswordPopupProps) {
    const { t } = useTranslation();

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                onConfirm(hostPassword);
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                onDismiss();
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [isOpen, onConfirm, onDismiss, hostPassword]);

    if (!isOpen) return null;

    return (
        <div
            className="absolute bottom-4 right-4 z-50 backdrop-blur-sm border border-border rounded-lg shadow-lg p-4 min-w-[280px]"
            style={{ backgroundColor: backgroundColor }}
        >
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-full">
                    <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h4 className="font-medium text-sm">
                        {t("terminal.sudoPasswordPopupTitle", "Insert password?")}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                        {t("terminal.sudoPasswordPopupHint", "Press Enter to insert, Esc to dismiss")}
                    </p>
                </div>
            </div>
            <div className="flex gap-2 justify-end">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDismiss}
                >
                    {t("terminal.sudoPasswordPopupDismiss", "Dismiss")}
                </Button>
                <Button
                    variant="default"
                    size="sm"
                    onClick={() => onConfirm(hostPassword)}
                >
                    {t("terminal.sudoPasswordPopupConfirm", "Insert")}
                </Button>
            </div>
        </div>
    );
}
