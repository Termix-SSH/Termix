import React from "react";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Badge} from "@/components/ui/badge.tsx";
import {X, ExternalLink, AlertTriangle, Info, CheckCircle, AlertCircle} from "lucide-react";
import {useTranslation} from "react-i18next";

interface TermixAlert {
    id: string;
    title: string;
    message: string;
    expiresAt: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    type?: 'info' | 'warning' | 'error' | 'success';
    actionUrl?: string;
    actionText?: string;
}

interface AlertCardProps {
    alert: TermixAlert;
    onDismiss: (alertId: string) => void;
    onClose: () => void;
}

const getAlertIcon = (type?: string) => {
    switch (type) {
        case 'warning':
            return <AlertTriangle className="h-5 w-5 text-yellow-500"/>;
        case 'error':
            return <AlertCircle className="h-5 w-5 text-red-500"/>;
        case 'success':
            return <CheckCircle className="h-5 w-5 text-green-500"/>;
        case 'info':
        default:
            return <Info className="h-5 w-5 text-blue-500"/>;
    }
};

const getPriorityBadgeVariant = (priority?: string) => {
    switch (priority) {
        case 'critical':
            return 'destructive';
        case 'high':
            return 'destructive';
        case 'medium':
            return 'secondary';
        case 'low':
        default:
            return 'outline';
    }
};

const getTypeBadgeVariant = (type?: string) => {
    switch (type) {
        case 'warning':
            return 'secondary';
        case 'error':
            return 'destructive';
        case 'success':
            return 'default';
        case 'info':
        default:
            return 'outline';
    }
};

export function HomepageAlertCard({alert, onDismiss, onClose}: AlertCardProps): React.ReactElement {
    const {t} = useTranslation();
    
    if (!alert) {
        return null;
    }

    const handleDismiss = () => {
        onDismiss(alert.id);
        onClose();
    };

    const formatExpiryDate = (expiryString: string) => {
        const expiryDate = new Date(expiryString);
        const now = new Date();
        const diffTime = expiryDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return t('common.expired');
        if (diffDays === 0) return t('common.expiresToday');
        if (diffDays === 1) return t('common.expiresTomorrow');
        return t('common.expiresInDays', {days: diffDays});
    };

    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {getAlertIcon(alert.type)}
                        <CardTitle className="text-xl font-bold">
                            {alert.title}
                        </CardTitle>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="h-8 w-8 p-0"
                    >
                        <X className="h-4 w-4"/>
                    </Button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                    {alert.priority && (
                        <Badge variant={getPriorityBadgeVariant(alert.priority)}>
                            {alert.priority.toUpperCase()}
                        </Badge>
                    )}
                    {alert.type && (
                        <Badge variant={getTypeBadgeVariant(alert.type)}>
                            {alert.type}
                        </Badge>
                    )}
                    <span className="text-sm text-muted-foreground">
                        {formatExpiryDate(alert.expiresAt)}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="pb-4">
                <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {alert.message}
                </p>
            </CardContent>
            <CardFooter className="flex items-center justify-between pt-0">
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={handleDismiss}
                    >
                        Dismiss
                    </Button>
                    {alert.actionUrl && alert.actionText && (
                        <Button
                            variant="default"
                            onClick={() => window.open(alert.actionUrl, '_blank', 'noopener,noreferrer')}
                            className="gap-2"
                        >
                            {alert.actionText}
                            <ExternalLink className="h-4 w-4"/>
                        </Button>
                    )}
                </div>
            </CardFooter>
        </Card>
    );
}
