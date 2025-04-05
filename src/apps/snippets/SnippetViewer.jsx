import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button, Input, Menu, MenuItem, IconButton, Chip, Textarea, FormLabel, Checkbox, Modal, ModalDialog, Tabs, TabList, Tab, TabPanel, Stack, FormControl, Select, Option, Box, DialogTitle, DialogContent } from "@mui/joy";
import ShareHostModal from "../../modals/ShareHostModal";
import ConfirmDeleteModal from "../../modals/ConfirmDeleteModal";
import { useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import io from "socket.io-client";

function SnippetViewer({
    getSnippets,
    userRef,
    onModalOpen,
    onModalClose,
    isMenuOpen,
    setIsMenuOpen,
    terminals,
    activeTab,
}) {
    const [snippets, setSnippets] = useState([]);
    const [filteredSnippets, setFilteredSnippets] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [collapsedFolders, setCollapsedFolders] = useState(new Set());
    const [draggedSnippet, setDraggedSnippet] = useState(null);
    const [isDraggingOver, setIsDraggingOver] = useState(null);
    const isMounted = useRef(true);
    const [deletingSnippetId, setDeletingSnippetId] = useState(null);
    const [isShareModalHidden, setIsShareModalHidden] = useState(true);
    const [selectedSnippetForShare, setSelectedSnippetForShare] = useState(null);
    const [selectedSnippet, setSelectedSnippet] = useState(null);
    const [selectedTags, setSelectedTags] = useState(new Set());
    const anchorEl = useRef(null);
    const menuRef = useRef(null);
    const [activeMenuButton, setActiveMenuButton] = useState(null);
    const [isPinningInProgress, setIsPinningInProgress] = useState(false);
    const [lastPinnedSnippet, setLastPinnedSnippet] = useState(null);
    const [editingSnippetId, setEditingSnippetId] = useState(null);
    const [snippetToDelete, setSnippetToDelete] = useState(null);
    const [isConfirmDeleteHidden, setIsConfirmDeleteHidden] = useState(true);
    const [isAddSnippetHidden, setIsAddSnippetHidden] = useState(true);
    const [newSnippet, setNewSnippet] = useState({
        name: "",
        content: "",
        folder: "",
        tags: []
    });
    const [selectedTerminals, setSelectedTerminals] = useState({});
    const [allTerminalsSelected, setAllTerminalsSelected] = useState(false);
    const [newTag, setNewTag] = useState("");
    const theme = useTheme();
    const [shareUsername, setShareUsername] = useState("");
    const [newFolderName, setNewFolderName] = useState("");
    const [activeModalTab, setActiveModalTab] = useState(0);
    const [isAddSnippetLoading, setIsAddSnippetLoading] = useState(false);

    // Add timeout refs similar to HostViewer
    const editingTimeoutId = useRef(null);

    // Add timestamp tracking for operations
    const [lastPinningTime, setLastPinningTime] = useState(0);
    const [lastDeleteTime, setLastDeleteTime] = useState(0);
    const [lastEditTime, setLastEditTime] = useState(0);
    const [lastFetchTime, setLastFetchTime] = useState(0);

    // Add a reference for pinning timeout
    const pinningTimeout = useRef(null);

    // Handle outside clicks to close menu
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target) && anchorEl.current && !anchorEl.current.contains(event.target)) {
                setIsMenuOpen(false);
                setSelectedSnippet(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Force close menu on any click
    useEffect(() => {
        const forceCloseMenuOnClick = (event) => {
            // Only close if clicked element is not part of menu
            if (isMenuOpen && !menuRef.current?.contains(event.target) && !anchorEl.current?.contains(event.target)) {
                setIsMenuOpen(false);
                setSelectedSnippet(null);
                setActiveMenuButton(null);
                anchorEl.current = null;
            }
        };
        
        window.addEventListener('click', forceCloseMenuOnClick);
        return () => window.removeEventListener('click', forceCloseMenuOnClick);
    }, [isMenuOpen]);

    // Fetch snippets with less UI disruption
    const fetchSnippets = async () => {
        try {
            // Set a flag to indicate a fetch is in progress
            const fetchStartTime = Date.now();
            setLastFetchTime(fetchStartTime);
            
            // Only set loading state on initial fetch when we have no snippets
            if (snippets.length === 0) {
                setIsLoading(true);
            }
            
            // Fetch snippets from server
            console.log("Fetching snippets from server");
            const savedSnippets = await getSnippets();
            
            // If component unmounted during fetch, don't update state
            if (!isMounted.current) return;
            
            // If this is an older fetch than a more recent one, ignore it
            if (fetchStartTime < lastFetchTime && lastFetchTime !== fetchStartTime) {
                console.log("Ignoring outdated fetch results");
                return;
            }

            if (savedSnippets && Array.isArray(savedSnippets)) {
                // Process snippets in batches to avoid blocking the UI
                const normalizedSnippets = savedSnippets.map(snippet => ({
                    ...snippet,
                    _id: snippet._id || snippet.id,
                    createdBy: snippet.createdBy 
                        ? (typeof snippet.createdBy === 'object' 
                            ? snippet.createdBy 
                            : { _id: snippet.createdBy, username: "Unknown" })
                        : null,
                    name: snippet.name || '',
                    content: snippet.content || '',
                    folder: snippet.folder || '',
                    isPinned: snippet.isPinned || false,
                    tags: snippet.tags || []
                }));
                
                // Preserve any active operations while updating (like pinning, editing, etc.)
                const updatedSnippets = normalizedSnippets.map(newSnippet => {
                    // Check if this snippet is currently being operated on
                    if (newSnippet._id === lastPinnedSnippet || 
                        newSnippet._id === editingSnippetId || 
                        newSnippet._id === deletingSnippetId) {
                        
                        // Find the current version of this snippet in our state
                        const currentVersion = snippets.find(s => s._id === newSnippet._id);
                        if (currentVersion) {
                            // Keep the UI state for this snippet (like isPinning, etc.)
                            return {
                                ...newSnippet,
                                // If we're pinning, use our current pin state
                                isPinned: lastPinnedSnippet === newSnippet._id 
                                    ? currentVersion.isPinned 
                                    : newSnippet.isPinned
                            };
                        }
                    }
                    return newSnippet;
                });
                
                // Do a deep comparison to prevent unnecessary updates
                const currentJson = JSON.stringify(snippets);
                const newJson = JSON.stringify(updatedSnippets);
                
                if (currentJson !== newJson) {
                    setSnippets(updatedSnippets);
                    
                    // Only update filtered snippets if necessary
                    if (searchTerm || selectedTags.size > 0) {
                        let filtered = [...updatedSnippets];
                        
                        // Apply tag filtering
                        if (selectedTags.size > 0) {
                            filtered = filterSnippetsByTags(filtered);
                        }
                        
                        // Apply search term filtering
                        if (searchTerm) {
                            filtered = filtered.filter(snippet => {
                                return snippet.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    snippet.folder?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    snippet.content?.toLowerCase().includes(searchTerm.toLowerCase());
                            });
                        }
                        
                        setFilteredSnippets(filtered);
                    } else {
                        setFilteredSnippets(updatedSnippets);
                    }
                }
            }
            
            // Clear loading state
            setIsLoading(false);
        } catch (error) {
            console.error("Fetch error:", error);
            if (isMounted.current) {
                setIsLoading(false);
            }
        }
    };

    // Initial load with reduced refresh interval
    useEffect(() => {
        isMounted.current = true;
        fetchSnippets();

        // Use a longer interval for fetching to reduce UI jank
        const intervalId = setInterval(() => {
            fetchSnippets();
        }, 2000); // Set to 2 seconds
        
        return () => {
            isMounted.current = false;
            clearInterval(intervalId);
        };
    }, []);

    // Make all folders available globally
    useEffect(() => {
        if (snippets.length > 0) {
            const allFolders = snippets
                .map(snippet => snippet.folder)
                .filter(Boolean);
            window.availableFolders = Array.from(new Set(allFolders));
        }
    }, [snippets]);

    // Filter snippets based on search term
    useEffect(() => {
        const filtered = snippets.filter((snippet) => {
            return snippet.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                snippet.folder?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                snippet.content?.toLowerCase().includes(searchTerm.toLowerCase());
        });
        setFilteredSnippets(filtered);
    }, [searchTerm, snippets]);

    // Modal state tracking
    useEffect(() => {
        if (!isShareModalHidden || !isAddSnippetHidden || !isConfirmDeleteHidden) {
            onModalOpen();
        } else {
            onModalClose();
        }
    }, [isShareModalHidden, isAddSnippetHidden, isConfirmDeleteHidden, onModalOpen, onModalClose]);

    // Initialize selected terminals when terminals change
    useEffect(() => {
        if (terminals && terminals.length > 0) {
            // Get currently selected terminal IDs
            const selectedIds = Object.entries(selectedTerminals)
                .filter(([_, isSelected]) => isSelected)
                .map(([id]) => parseInt(id));
            
            // Filter out any terminals that no longer exist
            const validSelectedIds = selectedIds.filter(
                id => terminals.some(t => t.id === id)
            );
            
            // Only auto-select if there's no valid selection AND we haven't explicitly deselected terminals
            const hasExplicitlyDeselected = Object.keys(selectedTerminals).length > 0 && 
                                           validSelectedIds.length === 0;
            
            if (validSelectedIds.length === 0 && !hasExplicitlyDeselected) {
                const newSelectedTerminals = {};
                
                // First try to select active tab if it exists
                if (activeTab && terminals.some(t => t.id === activeTab)) {
                    newSelectedTerminals[activeTab] = true;
                    console.log(`Selected active terminal ${activeTab}`);
                }
                // Otherwise select the first terminal
                else if (terminals.length > 0) {
                    newSelectedTerminals[terminals[0].id] = true;
                    console.log(`Selected first terminal ${terminals[0].id}`);
                }
                
                setSelectedTerminals(newSelectedTerminals);
            }
        }
    }, [terminals, activeTab, selectedTerminals]);

    // Cleanup function for unmounting
    useEffect(() => {
        isMounted.current = true;
        
        return () => {
            isMounted.current = false;
            // Reset all state on unmount
            setIsPinningInProgress(false);
            setLastPinnedSnippet(null);
            setDeletingSnippetId(null);
            setSnippetToDelete(null);
            setEditingSnippetId(null);
            setIsMenuOpen(false);
            setSelectedSnippet(null);
            
            // Clear all timeouts
            if (editingTimeoutId.current) {
                clearTimeout(editingTimeoutId.current);
                editingTimeoutId.current = null;
            }
            if (pinningTimeout.current) {
                clearTimeout(pinningTimeout.current);
                pinningTimeout.current = null;
            }
        };
    }, []);

    // Toggle checkbox for all terminals 
    useEffect(() => {
        if (terminals.length > 0) {
            const allSelected = terminals.every(terminal => selectedTerminals[terminal.id]);
            setAllTerminalsSelected(allSelected);
        }
    }, [selectedTerminals, terminals]);

    // Handle toggling folders open/closed
    const toggleFolder = (folderName) => {
        setCollapsedFolders((prev) => {
            const newCollapsed = new Set(prev);
            if (newCollapsed.has(folderName)) {
                newCollapsed.delete(folderName);
            } else {
                newCollapsed.add(folderName);
            }
            return newCollapsed;
        });
    };

    // Get a unique list of folders from snippets
    const getFolders = () => {
        return Array.from(
            new Set(
                snippets
                    .filter(snippet => snippet.folder && snippet.folder.trim())
                    .map(snippet => snippet.folder.trim())
            )
        ).sort();
    };

    // Group snippets by folder
    const groupSnippetsByFolder = (snippets) => {
        const grouped = {};
        const noFolder = [];

        const sortedSnippets = [...snippets].sort((a, b) => {
            if (a.isPinned !== b.isPinned) {
                return b.isPinned - a.isPinned;
            }
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        sortedSnippets.forEach(snippet => {
            const folder = snippet.folder;
            if (folder) {
                if (!grouped[folder]) {
                    grouped[folder] = [];
                }
                grouped[folder].push(snippet);
            } else {
                noFolder.push(snippet);
            }
        });

        const sortedFolders = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

        return { grouped, sortedFolders, noFolder };
    };

    // Filter snippets by selected tags
    const filterSnippetsByTags = (snippets) => {
        if (selectedTags.size === 0) return snippets;

        return snippets.filter(snippet => {
            const snippetTags = snippet.tags || [];
            return Array.from(selectedTags).every(tag => snippetTags.includes(tag));
        });
    };

    // Get all unique tags from snippets
    const getAllTags = (snippets) => {
        const tags = new Set();
        snippets.forEach(snippet => {
            const snippetTags = snippet.tags || [];
            snippetTags.forEach(tag => tags.add(tag));
        });
        return Array.from(tags).sort();
    };

    // Toggle a tag selection
    const toggleTag = (tag) => {
        setSelectedTags(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tag)) {
                newSet.delete(tag);
            } else {
                newSet.add(tag);
            }
            return newSet;
        });
    };

    // Drag and drop handlers
    const handleDragStart = (e, snippet) => {
        setDraggedSnippet(snippet);
        e.dataTransfer.setData('text/plain', '');
    };

    const handleDragOver = (e, folderName) => {
        e.preventDefault();
        setIsDraggingOver(folderName);
    };

    const handleDragLeave = () => {
        setIsDraggingOver(null);
    };

    const handleDrop = async (e, targetFolder) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(null);

        if (!draggedSnippet) return;
        if (draggedSnippet.folder === targetFolder) return;

        const newSnippet = {
            ...draggedSnippet,
            folder: targetFolder
        };

        try {
            await userRef.current.editSnippet({
                oldSnippet: draggedSnippet,
                newSnippet: newSnippet
            });
            await fetchSnippets();
        } catch (error) {
            console.error('Failed to update folder:', error);
        }

        setDraggedSnippet(null);
    };

    const handleDropOnNoFolder = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(null);

        if (!draggedSnippet || !draggedSnippet.folder) return;

        const newSnippet = {
            ...draggedSnippet,
            folder: null
        };

        try {
            await userRef.current.editSnippet({
                oldSnippet: draggedSnippet,
                newSnippet: newSnippet
            });
            await fetchSnippets();
        } catch (error) {
            console.error('Failed to remove from folder:', error);
        }

        setDraggedSnippet(null);
    };

    // Confirm delete dialog
    const confirmDelete = async (snippet) => {
        // Validate that snippet is defined and has a valid ID
        if (!snippet || !snippet._id) {
            console.error("Cannot confirm delete: Invalid snippet or missing ID");
            return;
        }
        
        setSnippetToDelete(snippet);
        setIsConfirmDeleteHidden(false);
        setIsMenuOpen(false);
        onModalOpen();
    };

    // Handle delete action with simplified state tracking
    const handleDelete = async (e, snippet) => {
        e?.stopPropagation();
        
        // Validate that snippet is defined and has a valid ID
        if (!snippet || !snippet._id) {
            console.error("Cannot delete: Invalid snippet or missing ID");
            return;
        }
        
        // Don't do anything if already deleting this snippet
        if (deletingSnippetId === snippet._id) {
            console.log("Already deleting this snippet, ignoring duplicate request");
            return;
        }

        // Make a deep copy and store ID separately for safety
        const snippetCopy = JSON.parse(JSON.stringify(snippet));
        const snippetId = snippetCopy._id;
        const isOwner = isSnippetOwner(snippetCopy);
        
        console.log(`Deleting snippet: ${snippetId}, isOwner: ${isOwner}`);
        
        // Update UI state
        setDeletingSnippetId(snippetId);
        setLastDeleteTime(Date.now());
        setIsConfirmDeleteHidden(true);
        onModalClose();
        
        // Apply optimistic UI update immediately
        setSnippets(prevSnippets => 
            prevSnippets.filter(s => s._id !== snippetId)
        );
        
        try {
            // Delete from database
            let success = false;
            if (isOwner) {
                success = await userRef.current.deleteSnippet({ snippetId });
                if (success) {
                    console.log(`Snippet ${snippetId} deleted successfully`);
                } else {
                    throw new Error("Server returned failure for delete operation");
                }
            } else {
                success = await userRef.current.removeSnippetShare(snippetId);
                if (success) {
                    console.log(`Snippet share ${snippetId} removed successfully`);
                } else {
                    throw new Error("Server returned failure for remove share operation");
                }
            }
            
            // Refresh the snippets list
            await fetchSnippets();
            
            // Success - clear state after a short delay
            setTimeout(() => {
                if (deletingSnippetId === snippetId && isMounted.current) {
                    setDeletingSnippetId(null);
                    setSnippetToDelete(null);
                    console.log("Delete state cleared after timeout");
                }
            }, 500);
        } catch (error) {
            console.error("Delete error:", error);
            
            // On error, add the snippet back
            if (isMounted.current) {
                setSnippets(prevSnippets => [snippetCopy, ...prevSnippets]);
                
                // Sort snippets after adding back
                setSnippets(prevSnippets => 
                    [...prevSnippets].sort((a, b) => {
                        if (a.isPinned !== b.isPinned) {
                            return b.isPinned - a.isPinned;
                        }
                        return a.name.localeCompare(b.name);
                    })
                );
            }
            
            // Clear state with delay
            setTimeout(() => {
                if (isMounted.current) {
                    setDeletingSnippetId(null);
                    setSnippetToDelete(null);
                }
            }, 500);
        }
    };

    // Handle share
    const handleShare = async (snippetId, username) => {
        if (!snippetId || !username) {
            console.error("Cannot share: Missing snippet ID or username");
            return false;
        }
        
        try {
            console.log(`Sharing snippet ${snippetId} with user ${username}`);
            await userRef.current.shareSnippet(snippetId, username);
            console.log("Snippet shared successfully");
            await fetchSnippets();
            return true;
        } catch (error) {
            console.error('Failed to share snippet:', error);
            return false;
        }
    };

    // Paste snippet to terminal instances directly 
    const pasteSnippetToTerminals = (snippet) => {
        try {
            console.log("Pasting snippet:", snippet.name);
            
            // Check if we have any terminals to paste to
            if (!areTerminalsAvailable()) {
                console.warn("No terminals available");
                return;
            }
            
            // Get terminals that are selected
            const selectedTerminalIds = Object.entries(selectedTerminals)
                .filter(([_, isSelected]) => isSelected)
                .map(([id]) => parseInt(id));
            
            // Only use selected terminals
            const terminalsToPasteTo = terminals.filter(t => selectedTerminalIds.includes(t.id));
            
            if (terminalsToPasteTo.length === 0) {
                console.warn("No terminals selected for pasting");
                return;
            }
            
            console.log(`Pasting to ${terminalsToPasteTo.length} terminals`);
            
            // Process content for terminal
            // First, handle line endings for the terminal
            let processedContent = snippet.content
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");
            
            // Make sure each line ends with carriage return for proper terminal display
            if (!processedContent.endsWith("\n")) {
                processedContent += "\n";
            }
            
            // Replace all newlines with carriage returns for terminal
            processedContent = processedContent.replace(/\n/g, "\r");
            
            // For each selected terminal, try to send the content
            terminalsToPasteTo.forEach(terminal => {
                const terminalId = terminal.id;
                
                try {
                    console.log(`Sending content to terminal ${terminalId}`);
                    
                    // Try different methods to access the socket
                    
                    // Method 1: Direct terminalRef access (most reliable)
                    if (terminal.terminalRef?.socketRef?.current?.connected) {
                        console.log(`Using terminal.terminalRef.socketRef for ${terminalId}`);
                        terminal.terminalRef.socketRef.current.emit("data", processedContent);
                        return;
                    }
                    
                    // Method 2: Global terminalSockets map
                    if (window.terminalSockets && window.terminalSockets[terminalId]?.connected) {
                        console.log(`Using window.terminalSockets for ${terminalId}`);
                        window.terminalSockets[terminalId].emit("data", processedContent);
                        return;
                    }
                    
                    // Method 3: Try to find any active terminal socket if specific one not found
                    const availableSockets = Object.values(window.terminalSockets || {})
                        .filter(socket => socket && socket.connected);
                    
                    if (availableSockets.length > 0) {
                        console.log(`Using first available socket for ${terminalId}`);
                        availableSockets[0].emit("data", processedContent);
                        return;
                    }
                    
                    console.warn(`No socket available for terminal ${terminalId}`);
                } catch (error) {
                    console.error(`Error pasting to terminal ${terminalId}:`, error);
                }
            });
        } catch (error) {
            console.error("Error in paste function:", error);
        }
    };

    // Render terminal selector
    const renderTerminalSelector = () => {
        if (!areTerminalsAvailable()) {
            return (
                <div className="mb-4 p-3 bg-neutral-800 rounded-lg text-neutral-300">
                    No terminals open. Open terminals to paste snippets.
                </div>
            );
        }

        return (
            <div className="mb-4 p-3 bg-neutral-800 rounded-lg">
                <div className="font-semibold mb-2 text-neutral-200">Select Terminals for Pasting</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    <div className="flex items-center p-2 bg-neutral-900 rounded">
                        <Checkbox
                            checked={allTerminalsSelected}
                            onChange={toggleAllTerminals}
                            sx={{
                                color: theme.palette.general.primary,
                                '&.Mui-checked': {
                                    color: theme.palette.general.primary,
                                },
                            }}
                        />
                        <span className="ml-2 font-medium">Select All</span>
                    </div>
                    {terminals.map(terminal => (
                        <div key={terminal.id} className="flex items-center p-2 bg-neutral-900 rounded">
                            <Checkbox
                                checked={!!selectedTerminals[terminal.id]}
                                onChange={() => toggleTerminalSelection(terminal.id)}
                                sx={{
                                    color: theme.palette.general.primary,
                                    '&.Mui-checked': {
                                        color: theme.palette.general.primary,
                                    },
                                }}
                            />
                            <span className="ml-2 truncate">{terminal.title}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // Render individual snippet item
    const renderSnippetItem = (snippet) => {
        // Use the helper function to determine ownership
        const isOwner = isSnippetOwner(snippet);
        
        const isMenuActive = activeMenuButton === snippet._id;
        
        // Only mark this specific snippet as busy - ensure precise ID comparison
        const isPinningThisSnippet = isPinningInProgress && lastPinnedSnippet === snippet._id;
        const isEditingThisSnippet = editingSnippetId === snippet._id;
        const isDeletingThisSnippet = deletingSnippetId === snippet._id;
        
        // Combine all busy states for this specific snippet
        const isThisSnippetBusy = isPinningThisSnippet || isEditingThisSnippet || isDeletingThisSnippet;
        
        const snippetTags = snippet.tags || [];
        
        // Determine if this is a shared snippet
        const isSharedSnippet = !isOwner && snippet.createdBy;
        
        // Get creator username for display
        const creatorUsername = (() => {
            if (!snippet.createdBy) return "Unknown";
            if (typeof snippet.createdBy === 'string') return "User";
            return snippet.createdBy.username || "Unknown User";
        })();
        
        // Get the right status message - make this really clear now
        const getStatusMessage = () => {
            if (isDeletingThisSnippet) return "Deleting...";
            if (isPinningThisSnippet) {
                // If the optimistic update has already happened, we need to look at the opposite
                // of the current state to determine what action is happening
                return !snippet.isPinned ? "Unpinning..." : "Pinning...";
            }
            if (isEditingThisSnippet) return "Updating...";
            return "";
        };
        
        return (
            <div
                key={snippet._id}
                className={`flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 w-full cursor-grab active:cursor-grabbing hover:border-neutral-500 transition-colors ${draggedSnippet === snippet ? 'opacity-50' : ''} ${isThisSnippetBusy ? 'border-neutral-500 border-2' : ''}`}
                draggable={isOwner}
                onDragStart={(e) => isOwner && handleDragStart(e, snippet)}
                onDragEnd={() => setDraggedSnippet(null)}
                style={{ 
                    width: '100%', 
                    maxWidth: '100%', 
                    overflow: 'hidden', 
                    boxSizing: 'border-box'
                }}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                    <div className="text-neutral-500 cursor-grab active:cursor-grabbing flex-shrink-0">⋮⋮</div>
                    <div className="min-w-0 overflow-hidden flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">
                                {snippet.name}
                            </p>
                            {isThisSnippetBusy && (
                                <span className="text-xs bg-neutral-600 text-neutral-300 px-2 py-1 rounded flex-shrink-0 animate-pulse"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    {getStatusMessage()}
                                </span>
                            )}
                            {snippet.isPinned && !isThisSnippetBusy && (
                                <span className="text-xs bg-neutral-700 text-neutral-300 px-2 py-1 rounded flex-shrink-0"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    Pinned
                                </span>
                            )}
                            {isSharedSnippet && (
                                <span className="text-xs bg-neutral-700 text-neutral-300 px-2 py-1 rounded flex-shrink-0"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    Shared by {creatorUsername}
                                </span>
                            )}
                            {snippetTags.map(tag => (
                                <span
                                    key={tag}
                                    className="text-xs bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded flex-shrink-0"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <div className="text-sm text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                            {snippet.content.substring(0, 50)}{snippet.content.length > 50 ? '...' : ''}
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                    <Button
                        variant="outlined"
                        className="text-white"
                        onClick={() => pasteSnippetToTerminals(snippet)}
                        disabled={isThisSnippetBusy || !canPasteToTerminals()}
                        title={
                            isThisSnippetBusy ? "Snippet is busy" :
                            !areTerminalsAvailable() ? "No terminals available" :
                            !areTerminalsSelected() ? "No terminals selected" :
                            "Paste to selected terminals"
                        }
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: canPasteToTerminals() ? "#0f0f0f" : "#6e6e6e" },
                            opacity: (isThisSnippetBusy || !canPasteToTerminals()) ? 0.5 : 1,
                            cursor: (isThisSnippetBusy || !canPasteToTerminals()) ? "not-allowed" : "pointer",
                            borderColor: "#3d3d3d",
                            borderWidth: "2px",
                            color: "#fff",
                            minWidth: "70px",
                            fontSize: "15px",
                            fontWeight: "bold"
                        }}
                    >
                        Paste
                    </Button>
                    <IconButton
                        variant="outlined"
                        className="text-white"
                        onClick={(e) => {
                            e.stopPropagation();
                            // Validate snippet has a valid ID
                            if (!snippet || !snippet._id) {
                                console.error("Cannot open menu: Invalid snippet or missing ID");
                                return;
                            }
                            setIsMenuOpen(true);
                            setSelectedSnippet(snippet);
                            setActiveMenuButton(snippet._id);
                            anchorEl.current = e.currentTarget;
                        }}
                        disabled={isThisSnippetBusy}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isThisSnippetBusy ? 0.5 : 1,
                            cursor: isThisSnippetBusy ? "not-allowed" : "pointer",
                            borderColor: "#3d3d3d",
                            borderWidth: "2px",
                            color: "#fff",
                            fontSize: "20px",
                            fontWeight: "bold"
                        }}
                    >
                        ⋮
                    </IconButton>
                </div>
            </div>
        );
    };

    // Render the snippet menu
    const renderSnippetMenu = () => {
        // Check for null/undefined selectedSnippet and valid ID
        if (!isMenuOpen || !selectedSnippet || !selectedSnippet._id) {
            return null;
        }

        return (
            <Menu
                ref={menuRef}
                open={isMenuOpen}
                anchorEl={anchorEl.current}
                onClose={() => setIsMenuOpen(false)}
                sx={{ backdropFilter: 'blur(30px)' }}
            >
                {isSnippetOwner(selectedSnippet) && (
                    <MenuItem 
                        onClick={(e) => {
                            e.stopPropagation();
                            handleEditSnippet(selectedSnippet);
                            setIsMenuOpen(false);
                        }}
                    >
                        Edit
                    </MenuItem>
                )}
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        // Create a deep copy to ensure we're working with a clean object
                        const snippetCopy = JSON.parse(JSON.stringify(selectedSnippet));
                        handlePinToggle(snippetCopy);
                        setIsMenuOpen(false);
                    }}
                >
                    {selectedSnippet.isPinned ? 'Unpin' : 'Pin'}
                </MenuItem>
                {isSnippetOwner(selectedSnippet) && (
                    <MenuItem 
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSnippetForShare(selectedSnippet);
                            setIsShareModalHidden(false);
                            setIsMenuOpen(false);
                        }}
                    >
                        Share
                    </MenuItem>
                )}
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(selectedSnippet);
                    }}
                    sx={{ color: '#ef4444' }}
                >
                    {isSnippetOwner(selectedSnippet) ? 'Delete' : 'Remove'}
                </MenuItem>
            </Menu>
        );
    };

    // Render share modal for snippets
    const renderShareModal = () => {
        if (isShareModalHidden || !selectedSnippetForShare) return null;

        return (
            <Modal 
                open={!isShareModalHidden} 
                onClose={() => {
                    setIsShareModalHidden(true);
                    setShareUsername('');
                }}
                sx={{
                    position: 'fixed',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(5px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                }}
            >
                <ModalDialog
                    layout="center"
                    variant="outlined"
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 3,
                        borderRadius: 10,
                        maxWidth: '400px',
                        width: '100%',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    <DialogTitle sx={{ mb: 2 }}>Share Snippet</DialogTitle>
                    <DialogContent>
                        <form onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (shareUsername.trim()) {
                                handleShare(selectedSnippetForShare._id, shareUsername.trim());
                                setIsShareModalHidden(true);
                                setSelectedSnippetForShare(null);
                                setShareUsername('');
                            }
                        }} onClick={(e) => e.stopPropagation()}>
                            <FormControl error={!shareUsername.trim()}>
                                <FormLabel>Username to share with</FormLabel>
                                <Input
                                    value={shareUsername}
                                    onChange={(e) => setShareUsername(e.target.value)}
                                    placeholder="Enter username"
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        color: theme.palette.text.primary,
                                        mb: 2
                                    }}
                                />
                            </FormControl>

                            <Button
                                type="submit"
                                disabled={!shareUsername.trim()}
                                onClick={(e) => e.stopPropagation()}
                                sx={{
                                    backgroundColor: theme.palette.general.primary,
                                    color: theme.palette.text.primary,
                                    '&:hover': {
                                        backgroundColor: theme.palette.general.disabled
                                    },
                                    '&:disabled': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                        color: 'rgba(255, 255, 255, 0.3)',
                                    },
                                    width: '100%',
                                    height: '40px',
                                }}
                            >
                                Share
                            </Button>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        );
    };

    // Handle toggling the pin status of a snippet
    const handlePinToggle = async (snippet) => {
        if (!snippet || !snippet._id) {
            console.error("Cannot toggle pin: Invalid snippet or missing ID");
            return;
        }

        try {
            // Clear any existing timeout
            if (pinningTimeout.current) {
                clearTimeout(pinningTimeout.current);
                pinningTimeout.current = null;
            }

            // Track which snippet is being pinned
            setIsPinningInProgress(true);
            setLastPinnedSnippet(snippet._id);
            setLastPinningTime(Date.now());

            // Create a deep copy to avoid reference issues
            const snippetCopy = JSON.parse(JSON.stringify(snippet));
            
            // Toggle the isPinned state
            snippetCopy.isPinned = !snippet.isPinned;
            
            // Apply optimistic UI update immediately
            const updatedSnippets = snippets.map(s => 
                s._id === snippet._id ? {...s, isPinned: !s.isPinned} : s
            );
            setSnippets(updatedSnippets);
            
            // Also update filtered snippets
            setFilteredSnippets(filtered => 
                filtered.map(s => s._id === snippet._id ? {...s, isPinned: !s.isPinned} : s)
            );
            
            // Use the socket directly for toggling pin, which is more reliable
            const socket = userRef.current.getSocketRef();
            
            socket.emit("toggleSnippetPin", {
                userId: userRef.current.getUser().id,
                sessionToken: userRef.current.getUser().sessionToken,
                snippetId: snippet._id,
                isPinned: snippetCopy.isPinned
            }, (response) => {
                // Handle the response
                if (response?.success) {
                    console.log(`Snippet ${snippetCopy.isPinned ? 'pinned' : 'unpinned'} successfully`);
                    
                    // Keep the indicator visible briefly so user can see the success
                    setTimeout(() => {
                        if (isMounted.current) {
                            // Update was successful, keep our optimistic UI update
                            setIsPinningInProgress(false);
                            setLastPinnedSnippet(null);
                        }
                    }, 500);
                } else {
                    console.error("Pin toggle failed:", response?.error || "Unknown error");
                    
                    // Revert the optimistic update on failure
                    setSnippets(prevSnippets => 
                        prevSnippets.map(s => 
                            s._id === snippet._id ? {...s, isPinned: snippet.isPinned} : s
                        )
                    );
                    
                    setFilteredSnippets(prevFiltered => 
                        prevFiltered.map(s => 
                            s._id === snippet._id ? {...s, isPinned: snippet.isPinned} : s
                        )
                    );
                    
                    setIsPinningInProgress(false);
                    setLastPinnedSnippet(null);
                }
            });
            
            // Set a timeout to clear the pinning state in case the server never responds
            pinningTimeout.current = setTimeout(() => {
                if (isMounted.current) {
                    setIsPinningInProgress(false);
                    setLastPinnedSnippet(null);
                    pinningTimeout.current = null;
                }
            }, 5000);
            
        } catch (error) {
            console.error("Error toggling pin:", error);
            
            // Revert the optimistic update on error
            setSnippets(prevSnippets => 
                prevSnippets.map(s => 
                    s._id === snippet._id ? {...s, isPinned: snippet.isPinned} : s
                )
            );
            
            setFilteredSnippets(prevFiltered => 
                prevFiltered.map(s => 
                    s._id === snippet._id ? {...s, isPinned: snippet.isPinned} : s
                )
            );
            
            setIsPinningInProgress(false);
            setLastPinnedSnippet(null);
        }
    };

    // Edit snippet with improved state handling - similar to HostViewer
    const handleEditSnippet = async (oldSnippet, newSnippet = null) => {
        try {
            // Clear any existing timeout to prevent early state clearing
            if (editingTimeoutId.current) {
                clearTimeout(editingTimeoutId.current);
                editingTimeoutId.current = null;
            }
            
            if (!oldSnippet || !oldSnippet._id) {
                console.error("Missing snippet for edit");
                return;
            }

            // If we have a selected snippet, use its ID directly
            let snippetToEdit = selectedSnippet;
            
            // If no selected snippet, try to find the snippet being edited
            if (!snippetToEdit || !snippetToEdit._id) {
                snippetToEdit = snippets.find(s => s._id === oldSnippet._id);
            }
            
            // We need the snippet ID for setting the editing state
            if (!snippetToEdit || !snippetToEdit._id) {
                console.error("Could not find snippet ID for editing");
                return;
            }
            
            // Track the snippet ID being edited
            const editingId = snippetToEdit._id;
            console.log(`Starting edit for snippet: ${editingId}`);
            
            // Set editing state for the UI
            setEditingSnippetId(editingId);
            setLastEditTime(Date.now());
            
            if (!newSnippet) {
                // Just opening the edit form - we'll keep the editing state active
                console.log(`Opening edit form for snippet: ${editingId}`);
                setNewSnippet({
                    ...oldSnippet,
                    tags: oldSnippet.tags || []
                });
                setIsAddSnippetHidden(false);
                return;
            }
            
            // Make sure tags are included in newSnippet
            if (!newSnippet.tags && oldSnippet.tags) {
                newSnippet.tags = oldSnippet.tags;
            }

            // Make sure _id is correctly passed if available
            if (!newSnippet._id && oldSnippet._id) {
                newSnippet._id = oldSnippet._id;
            }

            console.log(`Saving changes for snippet: ${editingId}`);
            
            // Create complete deep copies to prevent reference issues
            const oldSnippetCopy = JSON.parse(JSON.stringify(oldSnippet));
            const newSnippetCopy = JSON.parse(JSON.stringify(newSnippet));
            
            // Apply optimistic UI update immediately
            setSnippets(prevSnippets => 
                prevSnippets.map(s => 
                    s._id === editingId ? { ...s, ...newSnippetCopy } : s
                )
            );
            
            // Use the User component's editSnippet method directly
            const success = await userRef.current.editSnippet({
                oldSnippet: oldSnippetCopy,
                newSnippet: newSnippetCopy
            });
            
            if (!success) {
                throw new Error("Server returned failure for edit operation");
            }
            
            console.log("Edit successful via user component");
                
            // Fetch fresh data after edit
            await fetchSnippets();
            console.log("Snippet data refreshed after edit");
            
            // Don't clear immediately, set a longer timeout
            editingTimeoutId.current = setTimeout(() => {
                if (editingSnippetId === editingId && isMounted.current) {
                    setEditingSnippetId(null);
                    editingTimeoutId.current = null;
                    console.log("Edit state cleared after timeout");
                }
            }, 1000); // longer timeout for smoother UI
            
            return true;
        } catch (err) {
            console.error("Edit error:", err);
            
            // Wait before clearing editing state on error
            setTimeout(() => {
                if (isMounted.current) {
                    setEditingSnippetId(null);
                    if (editingTimeoutId.current) {
                        clearTimeout(editingTimeoutId.current);
                        editingTimeoutId.current = null;
                    }
                }
            }, 500);
            
            throw err; // Re-throw to allow error handling in the modal
        }
    };

    // Add useEffect to reset editing state when modal is closed (like HostViewer)
    useEffect(() => {
        // When the edit snippet modal is hidden/closed, don't immediately clear the editing state
        if (isAddSnippetHidden && editingSnippetId !== null) {
            // If we already have a timeout running, let it complete naturally
            // The editing state will be cleared by the existing timeout in handleEditSnippet
            if (!editingTimeoutId.current) {
                // Only if we don't have an active timeout, set a new one
                editingTimeoutId.current = setTimeout(() => {
                    setEditingSnippetId(null);
                    editingTimeoutId.current = null;
                }, 2000);
            }
        }
    }, [isAddSnippetHidden, editingSnippetId]);

    // Toggle terminal selection
    const toggleTerminalSelection = (terminalId) => {
        setSelectedTerminals(prev => ({
            ...prev,
            [terminalId]: !prev[terminalId]
        }));
    };

    // Toggle all terminals
    const toggleAllTerminals = () => {
        const newValue = !allTerminalsSelected;
        
        const newSelectedTerminals = {};
        terminals.forEach(terminal => {
            newSelectedTerminals[terminal.id] = newValue;
        });
        
        setSelectedTerminals(newSelectedTerminals);
    };

    // Get the active terminal
    const getActiveTerminal = () => {
        if (!activeTab || !terminals.length) return null;
        return terminals.find(t => t.id === activeTab);
    };

    // Helper functions for checking paste status
    const areTerminalsAvailable = () => terminals && terminals.length > 0;
    
    const areTerminalsSelected = () => Object.values(selectedTerminals).some(Boolean);
    
    const canPasteToTerminals = () => areTerminalsAvailable() && areTerminalsSelected();

    // Helper function to determine ownership
    const isSnippetOwner = (snippet) => {
        if (!snippet) return false;
        
        const currentUserId = userRef.current?.getUser()?.id;
        if (!currentUserId) return false;
        
        // Handle different possible formats of createdBy after PostgreSQL migration
        if (!snippet.createdBy) return false;
        
        // If createdBy is a string (just the ID)
        if (typeof snippet.createdBy === 'string') {
            return snippet.createdBy === currentUserId;
        }
        
        // If createdBy is an object with _id
        if (snippet.createdBy._id) {
            return snippet.createdBy._id === currentUserId;
        }
        
        // If createdBy is an object with id
        if (snippet.createdBy.id) {
            return snippet.createdBy.id === currentUserId;
        }
        
        return false;
    };

    // Add Snippet function - make it reliable
    const handleAddSnippet = async () => {
        if (!newSnippet.name || !newSnippet.content) {
            return;
        }

        try {
            // Set loading state
            setIsAddSnippetLoading(true);
            
            // Use the direct socket method like we did for pinning
            const socket = userRef.current.getSocketRef();
            const userId = userRef.current.getUser().id;
            const sessionToken = userRef.current.getUser().sessionToken;
            
            socket.emit("saveSnippet", {
                userId,
                sessionToken,
                snippet: {
                    name: newSnippet.name.trim(),
                    content: newSnippet.content.trim(),
                    folder: newSnippet.folder === "" ? null : newSnippet.folder,
                    tags: newSnippet.tags || [],
                    isPinned: newSnippet.isPinned || false
                }
            }, async (response) => {
                if (response?.success) {
                    console.log("Snippet added successfully");
                    
                    // Reset the form
                    setNewSnippet({
                        name: "",
                        content: "",
                        folder: "",
                        tags: []
                    });
                    
                    // Close the modal
                    setIsAddSnippetHidden(true);
                    setActiveModalTab(0);
                    
                    // Refresh the snippets
                    await fetchSnippets();
                } 
                
                // Always clear loading state
                setIsAddSnippetLoading(false);
            });
        } catch (error) {
            console.error("Error adding snippet:", error);
            setIsAddSnippetLoading(false);
        }
    };

    // Render the add/edit snippet modal
    const renderAddEditModal = () => {
        if (isAddSnippetHidden) return null;
        
        const isEditing = !!editingSnippetId;
        const modalTitle = isEditing ? 'Edit Snippet' : 'Add Snippet';
        const buttonText = isEditing ? 'Save Changes' : 'Add Snippet';
        
        return (
            <Modal
                open={!isAddSnippetHidden}
                onClose={() => setIsAddSnippetHidden(true)}
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    backdropFilter: 'blur(5px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                }}
            >
                <ModalDialog
                    layout="center"
                    variant="outlined"
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 0,
                        borderRadius: 10,
                        maxWidth: '650px',
                        width: '100%',
                        maxHeight: '80vh',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        mx: 2,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Tabs
                        value={activeModalTab}
                        onChange={(e, val) => setActiveModalTab(val)}
                        sx={{
                            width: '100%',
                            mb: 0,
                            backgroundColor: theme.palette.general.tertiary,
                        }}
                    >
                        <TabList
                            sx={{
                                width: '100%',
                                gap: 0,
                                borderTopLeftRadius: 10,
                                borderTopRightRadius: 10,
                                backgroundColor: theme.palette.general.primary,
                                '& button': {
                                    flex: 1,
                                    bgcolor: 'transparent',
                                    color: theme.palette.text.secondary,
                                    '&:hover': {
                                        bgcolor: theme.palette.general.disabled,
                                    },
                                    '&.Mui-selected': {
                                        bgcolor: theme.palette.general.tertiary,
                                        color: theme.palette.text.primary,
                                        '&:hover': {
                                            bgcolor: theme.palette.general.tertiary,
                                        },
                                    },
                                },
                            }}
                        >
                            <Tab sx={{ flex: 1 }}>Details</Tab>
                            <Tab sx={{ flex: 1 }}>Content</Tab>
                        </TabList>

                        <Box sx={{ 
                            flex: 1,
                            overflow: 'auto',
                            maxHeight: 'calc(80vh - 110px)', 
                            backgroundColor: theme.palette.general.tertiary 
                        }}>
                            <TabPanel value={0}>
                                <Stack spacing={2} sx={{ p: 2 }}>
                                    <FormControl error={!newSnippet.name}>
                                        <FormLabel>Name</FormLabel>
                                        <Input
                                            value={newSnippet.name}
                                            onChange={(e) => setNewSnippet({...newSnippet, name: e.target.value})}
                                            required
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                            }}
                                        />
                                    </FormControl>
                                    
                                    <FormControl>
                                        <FormLabel>Folder</FormLabel>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Input 
                                                value={newSnippet.folder || ''} 
                                                onChange={(e) => setNewSnippet({...newSnippet, folder: e.target.value})}
                                                placeholder="New Folder"
                                                sx={{
                                                    flex: 1,
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                            <Select
                                                value={newSnippet.folder || ''}
                                                onChange={(e, val) => setNewSnippet({...newSnippet, folder: val})}
                                                placeholder="New Folder"
                                                sx={{
                                                    width: '180px',
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            >
                                                <Option value="">No Folder</Option>
                                                {getFolders().map(folder => (
                                                    <Option key={folder} value={folder}>{folder}</Option>
                                                ))}
                                            </Select>
                                        </div>
                                    </FormControl>
                                    
                                    <FormControl>
                                        <FormLabel>Tags</FormLabel>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                            {newSnippet.tags?.map((tag) => (
                                                <Chip
                                                    key={tag}
                                                    variant="soft"
                                                    color="neutral"
                                                    sx={{
                                                        backgroundColor: theme.palette.general.primary,
                                                        color: theme.palette.text.primary,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '2px',
                                                        padding: '4px 4px 4px 8px',
                                                        position: 'relative'
                                                    }}
                                                >
                                                    <span>{tag}</span>
                                                    <span
                                                        onClick={() => {
                                                            setNewSnippet({
                                                                ...newSnippet,
                                                                tags: newSnippet.tags.filter(t => t !== tag)
                                                            });
                                                        }}
                                                        style={{
                                                            marginLeft: '4px',
                                                            color: 'red',
                                                            padding: '0 8px',
                                                            cursor: 'pointer',
                                                            fontWeight: 'bold',
                                                            fontSize: '16px',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        ×
                                                    </span>
                                                </Chip>
                                            ))}
                                        </Box>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Input
                                                value={newTag}
                                                onChange={(e) => setNewTag(e.target.value)}
                                                placeholder="Add tag"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        if (newTag.trim() && !newSnippet.tags?.includes(newTag.trim())) {
                                                            setNewSnippet({
                                                                ...newSnippet,
                                                                tags: [...(newSnippet.tags || []), newTag.trim()]
                                                            });
                                                            setNewTag("");
                                                        }
                                                    }
                                                }}
                                                sx={{
                                                    flex: 1,
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                            <IconButton
                                                size="sm"
                                                onClick={() => {
                                                    if (newTag.trim() && !newSnippet.tags?.includes(newTag.trim())) {
                                                        setNewSnippet({
                                                            ...newSnippet,
                                                            tags: [...(newSnippet.tags || []), newTag.trim()]
                                                        });
                                                        setNewTag("");
                                                    }
                                                }}
                                                disabled={!newTag.trim()}
                                            >
                                                <AddIcon />
                                            </IconButton>
                                        </div>
                                    </FormControl>

                                    <FormControl>
                                        <FormLabel>Pin Snippet</FormLabel>
                                        <Checkbox
                                            checked={Boolean(newSnippet.isPinned)}
                                            onChange={(e) => setNewSnippet({
                                                ...newSnippet,
                                                isPinned: e.target.checked,
                                            })}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                '&.Mui-checked': {
                                                    color: theme.palette.text.primary,
                                                },
                                            }}
                                        />
                                    </FormControl>
                                </Stack>
                            </TabPanel>
                            <TabPanel value={1}>
                                <FormControl error={!newSnippet.content} sx={{ height: '100%', p: 2 }}>
                                    <FormLabel>Content</FormLabel>
                                    <Textarea 
                                        value={newSnippet.content} 
                                        onChange={(e) => setNewSnippet({...newSnippet, content: e.target.value})}
                                        minRows={12}
                                        maxRows={20}
                                        required
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                            fontFamily: 'monospace',
                                            fontSize: '14px',
                                            height: '100%',
                                            flexGrow: 1,
                                            resize: 'vertical',
                                            overflow: 'auto',
                                        }}
                                    />
                                </FormControl>
                            </TabPanel>
                        </Box>

                        <Button
                            onClick={() => {
                                if (editingSnippetId) {
                                    handleEditSnippet(
                                        selectedSnippet, 
                                        { ...newSnippet, _id: selectedSnippet._id }
                                    );
                                } else {
                                    handleAddSnippet();
                                }
                                setIsAddSnippetHidden(true);
                            }}
                            disabled={!newSnippet.name || !newSnippet.content || isAddSnippetLoading}
                            sx={{
                                backgroundColor: theme.palette.general.primary,
                                color: theme.palette.text.primary,
                                '&:hover': {
                                    backgroundColor: theme.palette.general.disabled,
                                },
                                '&:disabled': {
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    color: 'rgba(255, 255, 255, 0.3)',
                                },
                                marginTop: 1,
                                width: '100%',
                                height: '40px',
                            }}
                        >
                            {isAddSnippetLoading ? "Processing..." : buttonText}
                        </Button>
                    </Tabs>
                </ModalDialog>
            </Modal>
        );
    };

    return (
        <div className="h-full flex flex-col p-4">
            <div className="flex gap-2 mb-4">
                <Input
                    placeholder="Search snippets..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-grow"
                    sx={{
                        backgroundColor: theme.palette.general.primary,
                        color: theme.palette.text.primary,
                    }}
                />
                <Button
                    onClick={() => {
                        setNewSnippet({
                            name: "",
                            content: "",
                            folder: "",
                            tags: []
                        });
                        setIsAddSnippetHidden(false);
                    }}
                    sx={{
                        backgroundColor: theme.palette.general.primary,
                        "&:hover": { backgroundColor: theme.palette.general.dark }
                    }}
                >
                    Add Snippet
                </Button>
            </div>
            
            {/* Terminal selector */}
            {renderTerminalSelector()}

            {/* Tags Filter */}
            <div className="flex flex-wrap gap-1 mb-2 w-full">
                {getAllTags(snippets).map(tag => (
                    <div
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        style={{
                            cursor: 'pointer',
                            backgroundColor: selectedTags.has(tag) ? theme.palette.general.primary : '#2a2a2a',
                            color: selectedTags.has(tag) ? 'white' : theme.palette.general.primary,
                            padding: '5px 10px',
                            borderRadius: '4px',
                            fontSize: '14px',
                            fontWeight: 'normal',
                            border: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: '28px'
                        }}
                    >
                        {tag}
                    </div>
                ))}
            </div>

            <div className="flex-grow overflow-auto w-full" style={{ width: '100%' }}>
                {filteredSnippets.length > 0 ? (
                    <div className="flex flex-col gap-2 w-full" style={{ width: '100%' }}>
                        {(() => {
                            const { grouped, sortedFolders, noFolder } = groupSnippetsByFolder(filterSnippetsByTags(filteredSnippets));

                            return (
                                <>
                                    {/* No folder container */}
                                    {noFolder.length > 0 && (
                                        <div key="no-folder" className="w-full mb-2" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                                            <div
                                                className={`flex items-center gap-2 p-2 bg-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-500 transition-colors w-full ${
                                                    isDraggingOver === 'no-folder' ? 'bg-neutral-500 border-2 border-dashed border-neutral-400' : ''
                                                }`}
                                                onClick={() => toggleFolder('no-folder')}
                                                onDragOver={(e) => handleDragOver(e, 'no-folder')}
                                                onDragLeave={handleDragLeave}
                                                onDrop={handleDropOnNoFolder}
                                                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                            >
                                                <span className={`font-bold w-4 text-center transition-transform ${collapsedFolders.has('no-folder') ? 'rotate-[-90deg]' : ''}`}>
                                                    ▼
                                                </span>
                                                <span className="font-bold truncate">No Folder</span>
                                                <span className="text-sm text-gray-300 flex-shrink-0">
                                                    ({noFolder.length})
                                                </span>
                                            </div>
                                            
                                            {!collapsedFolders.has('no-folder') && (
                                                <div 
                                                    className="mt-2 flex flex-col gap-2 w-full" 
                                                    style={{ 
                                                        width: '100%',
                                                        maxWidth: '100%',
                                                        boxSizing: 'border-box',
                                                        paddingLeft: '24px'
                                                    }}
                                                >
                                                    {noFolder.map((snippet) => renderSnippetItem(snippet))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Folders */}
                                    {sortedFolders.map((folderName) => (
                                        <div key={folderName} className="w-full mb-2" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                                            {/* Folder header */}
                                            <div
                                                className={`
                                                    flex items-center gap-2 p-2 bg-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-500 transition-colors w-full ${
                                                        isDraggingOver === folderName ? 'bg-neutral-500 border-2 border-dashed border-neutral-400' : ''
                                                    }`}
                                                onClick={() => toggleFolder(folderName)}
                                                onDragOver={(e) => handleDragOver(e, folderName)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={(e) => handleDrop(e, folderName)}
                                                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                            >
                                                <span className={`font-bold w-4 text-center transition-transform ${collapsedFolders.has(folderName) ? 'rotate-[-90deg]' : ''}`}>
                                                    ▼
                                                </span>
                                                <span className="font-bold truncate">{folderName}</span>
                                                <span className="text-sm text-gray-300">
                                                    ({grouped[folderName].length})
                                                </span>
                                            </div>
                                            
                                            {!collapsedFolders.has(folderName) && (
                                                <div 
                                                    className="mt-2 flex flex-col gap-2 w-full" 
                                                    style={{ 
                                                        width: '100%',
                                                        maxWidth: '100%',
                                                        boxSizing: 'border-box',
                                                        paddingLeft: '24px'
                                                    }}
                                                >
                                                    {grouped[folderName].map((snippet) => renderSnippetItem(snippet))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </>
                            );
                        })()}
                    </div>
                ) : (
                    <p className="text-gray-300">No snippets found.</p>
                )}
            </div>

            {/* Context Menu for Snippets */}
            {renderSnippetMenu()}

            {/* Add/Edit Snippet Modal */}
            {renderAddEditModal()}

            {/* Share Modal */}
            {renderShareModal()}

            {/* Confirm Delete Modal */}
            {!isConfirmDeleteHidden && snippetToDelete && (
                <ConfirmDeleteModal
                    isHidden={isConfirmDeleteHidden}
                    title={snippetToDelete.createdBy?._id === userRef.current?.getUser()?.id ? 'Delete Snippet' : 'Remove Shared Snippet'}
                    message={snippetToDelete.createdBy?._id === userRef.current?.getUser()?.id ? 
                        'Are you sure you want to delete this snippet?' : 
                        'Are you sure you want to remove this shared snippet?'}
                    itemName={snippetToDelete.name}
                    onConfirm={() => handleDelete(null, snippetToDelete)}
                    onCancel={() => {
                        setIsConfirmDeleteHidden(true);
                        setSnippetToDelete(null);
                        onModalClose();
                    }}
                />
            )}
        </div>
    );
}

SnippetViewer.propTypes = {
    getSnippets: PropTypes.func.isRequired,
    userRef: PropTypes.object.isRequired,
    onModalOpen: PropTypes.func.isRequired,
    onModalClose: PropTypes.func.isRequired,
    isMenuOpen: PropTypes.bool.isRequired,
    setIsMenuOpen: PropTypes.func.isRequired,
    terminals: PropTypes.array.isRequired,
    activeTab: PropTypes.number,
};

export default SnippetViewer; 