import React from 'react';
import {Button} from '@/components/ui/button.tsx';
import {X, Home} from 'lucide-react';

interface FileManagerTab {
    id: string | number;
    title: string;
}

interface FileManagerTabList {
    tabs: FileManagerTab[];
    activeTab: string | number;
    setActiveTab: (tab: string | number) => void;
    closeTab: (tab: string | number) => void;
    onHomeClick: () => void;
}

export function FileManagerTabList({tabs, activeTab, setActiveTab, closeTab, onHomeClick}: FileManagerTabList) {
    return (
        <div className="inline-flex items-center h-full gap-2">
            <Button
                onClick={onHomeClick}
                variant="outline"
                className={`ml-1 h-8 rounded-md flex items-center !px-2 border-1 border-dark-border ${activeTab === 'home' ? '!bg-dark-bg-active !text-white !border-dark-border-active !hover:bg-dark-bg-active !active:bg-dark-bg-active !focus:bg-dark-bg-active !hover:text-white !active:text-white !focus:text-white' : ''}`}
            >
                <Home className="w-4 h-4"/>
            </Button>
            {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                    <div key={tab.id} className="inline-flex rounded-md shadow-sm" role="group">
                        <Button
                            onClick={() => setActiveTab(tab.id)}
                            variant="outline"
                            className={`h-8 rounded-r-none !px-2 border-1 border-dark-border ${isActive ? '!bg-dark-bg-active !text-white !border-dark-border-active !hover:bg-dark-bg-active !active:bg-dark-bg-active !focus:bg-dark-bg-active !hover:text-white !active:text-white !focus:text-white' : ''}`}
                        >
                            {tab.title}
                        </Button>

                        <Button
                            onClick={() => closeTab(tab.id)}
                            variant="outline"
                            className="h-8 rounded-l-none p-0 !w-9 border-1 border-dark-border"
                        >
                            <X className="!w-4 !h-4" strokeWidth={2}/>
                        </Button>
                    </div>
                );
            })}
        </div>
    );
} 