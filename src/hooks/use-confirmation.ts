import {useState} from 'react';
import {toast} from 'sonner';

interface ConfirmationOptions {
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
}

export function useConfirmation() {
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmationOptions | null>(null);
    const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

    const confirm = (opts: ConfirmationOptions, callback: () => void) => {
        setOptions(opts);
        setOnConfirm(() => callback);
        setIsOpen(true);
    };

    const handleConfirm = () => {
        if (onConfirm) {
            onConfirm();
        }
        setIsOpen(false);
        setOptions(null);
        setOnConfirm(null);
    };

    const handleCancel = () => {
        setIsOpen(false);
        setOptions(null);
        setOnConfirm(null);
    };

    const confirmWithToast = (message: string, callback: () => void, variant: 'default' | 'destructive' = 'default') => {
        const actionText = variant === 'destructive' ? 'Delete' : 'Confirm';
        const cancelText = 'Cancel';

        toast(message, {
            action: {
                label: actionText,
                onClick: callback
            },
            cancel: {
                label: cancelText,
                onClick: () => {
                }
            },
            duration: 10000,
            className: variant === 'destructive' ? 'border-red-500' : ''
        });
    };

    return {
        isOpen,
        options,
        confirm,
        handleConfirm,
        handleCancel,
        confirmWithToast
    };
}
