import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { getCredentials } from '@/ui/main-axios';
import { useTranslation } from "react-i18next";
import type { Credential } from '../types/index.js';

interface CredentialSelectorProps {
    value?: number | null;
    onValueChange: (credentialId: number | null) => void;
    onCredentialSelect?: (credential: Credential | null) => void;
}

export function CredentialSelector({ value, onValueChange, onCredentialSelect }: CredentialSelectorProps) {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [loading, setLoading] = useState(true);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchCredentials = async () => {
            try {
                setLoading(true);
                const data = await getCredentials();
                const credentialsArray = Array.isArray(data) ? data : (data.credentials || data.data || []);
                setCredentials(credentialsArray);
            } catch (error) {
                console.error('Failed to fetch credentials:', error);
                const {toast} = await import('sonner');
                toast.error(t('credentials.failedToFetchCredentials'));
                setCredentials([]);
            } finally {
                setLoading(false);
            }
        };

        fetchCredentials();
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target as Node)
            ) {
                setDropdownOpen(false);
            }
        }

        if (dropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [dropdownOpen]);

    const selectedCredential = credentials.find(c => c.id === value);

    const filteredCredentials = credentials.filter(credential => {
        if (!searchQuery) return true;
        const searchLower = searchQuery.toLowerCase();
        return (
            credential.name.toLowerCase().includes(searchLower) ||
            credential.username.toLowerCase().includes(searchLower) ||
            (credential.folder && credential.folder.toLowerCase().includes(searchLower))
        );
    });

    const handleCredentialSelect = (credential: Credential) => {
        onValueChange(credential.id);
        if (onCredentialSelect) {
            onCredentialSelect(credential);
        }
        setDropdownOpen(false);
        setSearchQuery('');
    };

    const handleClear = () => {
        onValueChange(null);
        if (onCredentialSelect) {
            onCredentialSelect(null);
        }
        setDropdownOpen(false);
        setSearchQuery('');
    };

    return (
        <FormItem>
            <FormLabel>{t('hosts.selectCredential')}</FormLabel>
            <FormControl>
                <div className="relative">
                    <Button
                        ref={buttonRef}
                        type="button"
                        variant="outline"
                        className="w-full justify-between text-left rounded-lg px-3 py-2 bg-muted/50 focus:bg-background focus:ring-1 focus:ring-ring border border-border text-foreground transition-all duration-200"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                    >
                        {loading ? (
                            t('common.loading')
                        ) : value === "existing_credential" ? (
                            <div className="flex items-center justify-between w-full">
                                <div>
                                    <span className="font-medium">{t('hosts.existingCredential')}</span>
                                </div>
                            </div>
                        ) : selectedCredential ? (
                            <div className="flex items-center justify-between w-full">
                                <div>
                                    <span className="font-medium">{selectedCredential.name}</span>
                                    <span className="text-sm text-muted-foreground ml-2">
                                        ({selectedCredential.username} • {selectedCredential.authType})
                                    </span>
                                </div>
                            </div>
                        ) : (
                            t('hosts.selectCredentialPlaceholder')
                        )}
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </Button>

                    {dropdownOpen && (
                        <div
                            ref={dropdownRef}
                            className="absolute top-full left-0 z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-hidden backdrop-blur-sm"
                        >
                            <div className="p-2 border-b border-border">
                                <Input
                                    placeholder={t('credentials.searchCredentials')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="h-8"
                                />
                            </div>

                            <div className="max-h-60 overflow-y-auto p-2">
                                {loading ? (
                                    <div className="p-3 text-center text-sm text-muted-foreground">
                                        {t('common.loading')}
                                    </div>
                                ) : filteredCredentials.length === 0 ? (
                                    <div className="p-3 text-center text-sm text-muted-foreground">
                                        {searchQuery ? t('credentials.noCredentialsMatchFilters') : t('credentials.noCredentialsYet')}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-2.5">
                                        {value && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="w-full justify-start text-left rounded-lg px-3 py-2 text-destructive hover:bg-destructive/10 transition-colors duration-200"
                                                onClick={handleClear}
                                            >
                                                {t('common.clear')}
                                            </Button>
                                        )}
                                        {filteredCredentials.map((credential) => (
                                            <Button
                                                key={credential.id}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className={`w-full justify-start text-left rounded-lg px-3 py-7 hover:bg-muted focus:bg-muted focus:outline-none transition-colors duration-200 ${
                                                    credential.id === value ? 'bg-muted' : ''
                                                }`}
                                                onClick={() => handleCredentialSelect(credential)}
                                            >
                                                <div className="w-full">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{credential.name}</span>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-0.5">
                                                        {credential.username} • {credential.authType}
                                                        {credential.description && ` • ${credential.description}`}
                                                    </div>
                                                </div>
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </div>

                        </div>
                    )}
                </div>
            </FormControl>
        </FormItem>
    );
}