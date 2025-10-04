import React, { useState } from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChevronDown, ChevronUpIcon, Hammer } from "lucide-react";
import { Tab } from "@/ui/Desktop/Navigation/Tabs/Tab.tsx";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { useTranslation } from "react-i18next";
import { TabDropdown } from "@/ui/Desktop/Navigation/Tabs/TabDropdown.tsx";
import { getCookie, setCookie } from "@/ui/main-axios.ts";

interface TopNavbarProps {
  isTopbarOpen: boolean;
  setIsTopbarOpen: (open: boolean) => void;
}

export function TopNavbar({
  isTopbarOpen,
  setIsTopbarOpen,
}: TopNavbarProps): React.ReactElement {
  const { state } = useSidebar();
  const {
    tabs,
    currentTab,
    setCurrentTab,
    setSplitScreenTab,
    removeTab,
    allSplitScreenTab,
  } = useTabs() as any;
  const leftPosition = state === "collapsed" ? "26px" : "264px";
  const { t } = useTranslation();

  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedTabIds, setSelectedTabIds] = useState<number[]>([]);

  const handleTabActivate = (tabId: number) => {
    setCurrentTab(tabId);
  };

  const handleTabSplit = (tabId: number) => {
    setSplitScreenTab(tabId);
  };

  const handleTabClose = (tabId: number) => {
    removeTab(tabId);
  };

  const handleTabToggle = (tabId: number) => {
    setSelectedTabIds((prev) =>
      prev.includes(tabId)
        ? prev.filter((id) => id !== tabId)
        : [...prev, tabId],
    );
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    setTimeout(() => {
      const input = document.getElementById(
        "ssh-tools-input",
      ) as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setSelectedTabIds([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (selectedTabIds.length === 0) return;

    let commandToSend = "";

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "c") {
        commandToSend = "\x03"; // Ctrl+C (SIGINT)
        e.preventDefault();
      } else if (e.key === "d") {
        commandToSend = "\x04"; // Ctrl+D (EOF)
        e.preventDefault();
      } else if (e.key === "l") {
        commandToSend = "\x0c"; // Ctrl+L (clear screen)
        e.preventDefault();
      } else if (e.key === "u") {
        commandToSend = "\x15"; // Ctrl+U (clear line)
        e.preventDefault();
      } else if (e.key === "k") {
        commandToSend = "\x0b"; // Ctrl+K (clear from cursor to end)
        e.preventDefault();
      } else if (e.key === "a") {
        commandToSend = "\x01"; // Ctrl+A (move to beginning of line)
        e.preventDefault();
      } else if (e.key === "e") {
        commandToSend = "\x05"; // Ctrl+E (move to end of line)
        e.preventDefault();
      } else if (e.key === "w") {
        commandToSend = "\x17"; // Ctrl+W (delete word before cursor)
        e.preventDefault();
      }
    } else if (e.key === "Enter") {
      commandToSend = "\n";
      e.preventDefault();
    } else if (e.key === "Backspace") {
      commandToSend = "\x08"; // Backspace
      e.preventDefault();
    } else if (e.key === "Delete") {
      commandToSend = "\x7f"; // Delete
      e.preventDefault();
    } else if (e.key === "Tab") {
      commandToSend = "\x09"; // Tab
      e.preventDefault();
    } else if (e.key === "Escape") {
      commandToSend = "\x1b"; // Escape
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      commandToSend = "\x1b[A"; // Up arrow
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      commandToSend = "\x1b[B"; // Down arrow
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      commandToSend = "\x1b[D"; // Left arrow
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      commandToSend = "\x1b[C"; // Right arrow
      e.preventDefault();
    } else if (e.key === "Home") {
      commandToSend = "\x1b[H"; // Home
      e.preventDefault();
    } else if (e.key === "End") {
      commandToSend = "\x1b[F"; // End
      e.preventDefault();
    } else if (e.key === "PageUp") {
      commandToSend = "\x1b[5~"; // Page Up
      e.preventDefault();
    } else if (e.key === "PageDown") {
      commandToSend = "\x1b[6~"; // Page Down
      e.preventDefault();
    } else if (e.key === "Insert") {
      commandToSend = "\x1b[2~"; // Insert
      e.preventDefault();
    } else if (e.key === "F1") {
      commandToSend = "\x1bOP"; // F1
      e.preventDefault();
    } else if (e.key === "F2") {
      commandToSend = "\x1bOQ"; // F2
      e.preventDefault();
    } else if (e.key === "F3") {
      commandToSend = "\x1bOR"; // F3
      e.preventDefault();
    } else if (e.key === "F4") {
      commandToSend = "\x1bOS"; // F4
      e.preventDefault();
    } else if (e.key === "F5") {
      commandToSend = "\x1b[15~"; // F5
      e.preventDefault();
    } else if (e.key === "F6") {
      commandToSend = "\x1b[17~"; // F6
      e.preventDefault();
    } else if (e.key === "F7") {
      commandToSend = "\x1b[18~"; // F7
      e.preventDefault();
    } else if (e.key === "F8") {
      commandToSend = "\x1b[19~"; // F8
      e.preventDefault();
    } else if (e.key === "F9") {
      commandToSend = "\x1b[20~"; // F9
      e.preventDefault();
    } else if (e.key === "F10") {
      commandToSend = "\x1b[21~"; // F10
      e.preventDefault();
    } else if (e.key === "F11") {
      commandToSend = "\x1b[23~"; // F11
      e.preventDefault();
    } else if (e.key === "F12") {
      commandToSend = "\x1b[24~"; // F12
      e.preventDefault();
    }

    if (commandToSend) {
      selectedTabIds.forEach((tabId) => {
        const tab = tabs.find((t: any) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(commandToSend);
        }
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (selectedTabIds.length === 0) return;

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const char = e.key;
      selectedTabIds.forEach((tabId) => {
        const tab = tabs.find((t: any) => t.id === tabId);
        if (tab?.terminalRef?.current?.sendInput) {
          tab.terminalRef.current.sendInput(char);
        }
      });
    }
  };

  const isSplitScreenActive =
    Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;
  const currentTabObj = tabs.find((t: any) => t.id === currentTab);
  const currentTabIsHome = currentTabObj?.type === "home";
  const currentTabIsSshManager = currentTabObj?.type === "ssh_manager";
  const currentTabIsAdmin = currentTabObj?.type === "admin";
  const currentTabIsUserProfile = currentTabObj?.type === "user_profile";

  const terminalTabs = tabs.filter((tab: any) => tab.type === "terminal");

  const updateRightClickCopyPaste = (checked: boolean) => {
    setCookie("rightClickCopyPaste", checked.toString());
  };

  return (
    <div>
      <div
        className="fixed z-10 h-[50px] bg-dark-bg border-2 border-dark-border rounded-lg transition-all duration-200 ease-linear flex flex-row transform-none m-0 p-0"
        style={{
          top: isTopbarOpen ? "0.5rem" : "-3rem",
          left: leftPosition,
          right: "17px",
        }}
      >
        <div className="h-full p-1 pr-2 border-r-2 border-dark-border w-[calc(100%-6rem)] flex items-center overflow-x-auto overflow-y-hidden gap-2 thin-scrollbar">
          {tabs.map((tab: any) => {
            const isActive = tab.id === currentTab;
            const isSplit =
              Array.isArray(allSplitScreenTab) &&
              allSplitScreenTab.includes(tab.id);
            const isTerminal = tab.type === "terminal";
            const isServer = tab.type === "server";
            const isFileManager = tab.type === "file_manager";
            const isSshManager = tab.type === "ssh_manager";
            const isAdmin = tab.type === "admin";
            const isUserProfile = tab.type === "user_profile";
            const isSplittable = isTerminal || isServer || isFileManager;
            const isSplitButtonDisabled =
              (isActive && !isSplitScreenActive) ||
              ((allSplitScreenTab?.length || 0) >= 3 && !isSplit);
            const disableSplit =
              !isSplittable ||
              isSplitButtonDisabled ||
              isActive ||
              currentTabIsHome ||
              currentTabIsSshManager ||
              currentTabIsAdmin ||
              currentTabIsUserProfile;
            const disableActivate =
              isSplit ||
              ((tab.type === "home" ||
                tab.type === "ssh_manager" ||
                tab.type === "admin" ||
                tab.type === "user_profile") &&
                isSplitScreenActive);
            const disableClose = (isSplitScreenActive && isActive) || isSplit;
            return (
              <Tab
                key={tab.id}
                tabType={tab.type}
                title={tab.title}
                isActive={isActive}
                onActivate={() => handleTabActivate(tab.id)}
                onClose={
                  isTerminal ||
                  isServer ||
                  isFileManager ||
                  isSshManager ||
                  isAdmin ||
                  isUserProfile
                    ? () => handleTabClose(tab.id)
                    : undefined
                }
                onSplit={
                  isSplittable ? () => handleTabSplit(tab.id) : undefined
                }
                canSplit={isSplittable}
                canClose={
                  isTerminal ||
                  isServer ||
                  isFileManager ||
                  isSshManager ||
                  isAdmin ||
                  isUserProfile
                }
                disableActivate={disableActivate}
                disableSplit={disableSplit}
                disableClose={disableClose}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-2 flex-1 px-2">
          <TabDropdown />

          <Button
            variant="outline"
            className="w-[30px] h-[30px]"
            title={t("nav.tools")}
            onClick={() => setToolsSheetOpen(true)}
          >
            <Hammer className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            onClick={() => setIsTopbarOpen(false)}
            className="w-[30px] h-[30px]"
          >
            <ChevronUpIcon />
          </Button>
        </div>
      </div>

      {!isTopbarOpen && (
        <div
          onClick={() => setIsTopbarOpen(true)}
          className="absolute top-0 left-0 w-full h-[10px] bg-dark-bg cursor-pointer z-20 flex items-center justify-center rounded-bl-md rounded-br-md"
        >
          <ChevronDown size={10} />
        </div>
      )}

      {toolsSheetOpen && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 z-[999999] flex justify-end pointer-events-auto isolate"
          style={{
            transform: "translateZ(0)",
          }}
        >
          <div
            className="flex-1 cursor-pointer"
            onClick={() => setToolsSheetOpen(false)}
          />

          <div
            className="w-[400px] h-full bg-dark-bg border-l-2 border-dark-border flex flex-col shadow-2xl relative isolate z-[999999]"
            style={{
              boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.5)",
              transform: "translateZ(0)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-dark-border">
              <h2 className="text-lg font-semibold text-white">
                {t("sshTools.title")}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setToolsSheetOpen(false)}
                className="h-8 w-8 p-0 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
                title={t("sshTools.closeTools")}
              >
                <span className="text-lg font-bold leading-none">×</span>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <h1 className="font-semibold">{t("sshTools.keyRecording")}</h1>

                <div className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      {!isRecording ? (
                        <Button
                          onClick={handleStartRecording}
                          className="flex-1"
                          variant="outline"
                        >
                          {t("sshTools.startKeyRecording")}
                        </Button>
                      ) : (
                        <Button
                          onClick={handleStopRecording}
                          className="flex-1"
                          variant="destructive"
                        >
                          {t("sshTools.stopKeyRecording")}
                        </Button>
                      )}
                    </div>

                    {isRecording && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">
                            {t("sshTools.selectTerminals")}
                          </label>
                          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto mt-2">
                            {terminalTabs.map((tab) => (
                              <Button
                                key={tab.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                className={`rounded-full px-3 py-1 text-xs flex items-center gap-1 ${
                                  selectedTabIds.includes(tab.id)
                                    ? "text-white bg-gray-700"
                                    : "text-gray-500"
                                }`}
                                onClick={() => handleTabToggle(tab.id)}
                              >
                                {tab.title}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">
                            {t("sshTools.typeCommands")}
                          </label>
                          <Input
                            id="ssh-tools-input"
                            placeholder={t("placeholders.typeHere")}
                            onKeyDown={handleKeyDown}
                            onKeyPress={handleKeyPress}
                            className="font-mono mt-2"
                            disabled={selectedTabIds.length === 0}
                            readOnly
                          />
                          <p className="text-xs text-muted-foreground">
                            {t("sshTools.commandsWillBeSent", {
                              count: selectedTabIds.length,
                            })}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <Separator className="my-4" />

                <h1 className="font-semibold">{t("sshTools.settings")}</h1>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enable-copy-paste"
                    onCheckedChange={updateRightClickCopyPaste}
                    defaultChecked={getCookie("rightClickCopyPaste") === "true"}
                  />
                  <label
                    htmlFor="enable-copy-paste"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-white"
                  >
                    {t("sshTools.enableRightClickCopyPaste")}
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enable-tmux-auto-attach"
                    onCheckedChange={(checked) =>
                      setCookie("tmuxAutoAttach", checked.toString())
                    }
                    defaultChecked={getCookie("tmuxAutoAttach") === "true"}
                  />
                  <label
                    htmlFor="enable-tmux-auto-attach"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-white"
                  >
                    {t("sshTools.enableTmuxAutoAttach")}
                  </label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  {t("sshTools.tmuxAutoAttachDesc")}
                </p>

                <Separator className="my-4" />

                <p className="pt-2 pb-2 text-sm text-gray-500">
                  {t("sshTools.shareIdeas")}{" "}
                  <a
                    href="https://github.com/LukeGus/Termix/issues/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    GitHub
                  </a>
                  !
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
