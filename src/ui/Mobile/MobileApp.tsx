import React, {useRef, FC, useState, useEffect} from "react";
import {Terminal} from "@/ui/Mobile/Apps/Terminal/Terminal.tsx";
import {TerminalKeyboard} from "@/ui/Mobile/Apps/Terminal/TerminalKeyboard.tsx";
import {BottomNavbar} from "@/ui/Mobile/Apps/Navigation/BottomNavbar.tsx";
import {LeftSidebar} from "@/ui/Mobile/Apps/Navigation/LeftSidebar.tsx";
import {TabProvider, useTabs} from "@/ui/Mobile/Apps/Navigation/Tabs/TabContext.tsx";
import {getUserInfo} from "@/ui/main-axios.ts";
import {HomepageAuth} from "@/ui/Mobile/Homepage/HomepageAuth.tsx";

function getCookie(name: string) {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r;
    }, "");
}

const AppContent: FC = () => {
    const {tabs, currentTab, getTab} = useTabs();
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
    const [ready, setReady] = React.useState(true);

    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        const checkAuth = () => {
            const jwt = getCookie("jwt");
            if (jwt) {
                setAuthLoading(true);
                getUserInfo()
                    .then((meRes) => {
                        setIsAuthenticated(true);
                        setIsAdmin(!!meRes.is_admin);
                        setUsername(meRes.username || null);
                    })
                    .catch((err) => {
                        setIsAuthenticated(false);
                        setIsAdmin(false);
                        setUsername(null);
                        document.cookie = 'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                    })
                    .finally(() => setAuthLoading(false));
            } else {
                setIsAuthenticated(false);
                setIsAdmin(false);
                setUsername(null);
                setAuthLoading(false);
            }
        }

        checkAuth()

        const handleStorageChange = () => checkAuth()
        window.addEventListener('storage', handleStorageChange)

        return () => window.removeEventListener('storage', handleStorageChange)
    }, [])

    const handleAuthSuccess = (authData: { isAdmin: boolean; username: string | null; userId: string | null }) => {
        setIsAuthenticated(true)
        setIsAdmin(authData.isAdmin)
        setUsername(authData.username)
    }

    const fitCurrentTerminal = () => {
        const tab = getTab(currentTab as number);
        if (tab && tab.terminalRef?.current?.fit) {
            tab.terminalRef.current.fit();
        }
    };

    React.useEffect(() => {
        if (tabs.length > 0) {
            setReady(false);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    fitCurrentTerminal();
                    setReady(true);
                });
            });
        }
    }, [currentTab]);

    const closeSidebar = () => setIsSidebarOpen(false);

    function handleKeyboardInput(input: string) {
        const currentTerminalTab = getTab(currentTab as number);
        if (currentTerminalTab && currentTerminalTab.terminalRef?.current?.sendInput) {
            currentTerminalTab.terminalRef.current.sendInput(input);
        }
    }

    if (authLoading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#09090b]">
                <p className="text-white">Loading...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#18181b] p-4">
                <HomepageAuth
                    setLoggedIn={setIsAuthenticated}
                    setIsAdmin={setIsAdmin}
                    setUsername={setUsername}
                    setUserId={(id) => {
                    }}
                    loggedIn={isAuthenticated}
                    authLoading={authLoading}
                    dbError={null}
                    setDbError={(err) => {
                    }}
                    onAuthSuccess={handleAuthSuccess}
                />
            </div>
        )
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-[#09090b] overflow-y-hidden overflow-x-hidden relative">
            <div className="flex-1 min-h-0 relative">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className="absolute inset-0"
                        style={{
                            visibility: tab.id === currentTab ? 'visible' : 'hidden',
                            opacity: ready ? 1 : 0,
                        }}
                    >
                        <Terminal
                            ref={tab.terminalRef}
                            hostConfig={tab.hostConfig}
                            isVisible={tab.id === currentTab}
                        />
                    </div>
                ))}
                {tabs.length === 0 && (
                    <div className="flex items-center justify-center h-full text-white">
                        Select a host to start a terminal session.
                    </div>
                )}
            </div>
            {currentTab && <TerminalKeyboard onSendInput={handleKeyboardInput}/>}
            <BottomNavbar
                onSidebarOpenClick={() => setIsSidebarOpen(true)}
            />

            {isSidebarOpen && (
                <div
                    className="absolute inset-0 bg-black/30 backdrop-blur-sm z-10"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <div className="absolute top-0 left-0 h-full z-20 pointer-events-none">
                <div onClick={(e) => {
                    e.stopPropagation();
                }} className="pointer-events-auto">
                    <LeftSidebar
                        isSidebarOpen={isSidebarOpen}
                        setIsSidebarOpen={setIsSidebarOpen}
                        onHostConnect={closeSidebar}
                        disabled={!isAuthenticated || authLoading}
                        username={username}
                    />
                </div>
            </div>
        </div>
    );
}

export const MobileApp: FC = () => {
    return (
        <TabProvider>
            <AppContent/>
        </TabProvider>
    );
}