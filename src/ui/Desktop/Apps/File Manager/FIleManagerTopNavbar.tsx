import React from "react";
import {FileManagerTabList} from "./FileManagerTabList.tsx";

interface FileManagerTopNavbarProps {
    tabs: { id: string | number, title: string }[];
    activeTab: string | number;
    setActiveTab: (tab: string | number) => void;
    closeTab: (tab: string | number) => void;
    onHomeClick: () => void;
}

export function FIleManagerTopNavbar(props: FileManagerTopNavbarProps): React.ReactElement {
    const {tabs, activeTab, setActiveTab, closeTab, onHomeClick} = props;

    return (
        <FileManagerTabList
            tabs={tabs}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            closeTab={closeTab}
            onHomeClick={onHomeClick}
        />
    );
}