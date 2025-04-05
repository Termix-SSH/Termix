import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button, Input, Menu, MenuItem, IconButton, Chip } from "@mui/joy";
import ShareHostModal from "../../modals/ShareHostModal";
import ConfirmDeleteModal from "../../modals/ConfirmDeleteModal";
import { useTheme } from "@mui/material";

function HostViewer({
                        getHosts,
                        connectToHost,
                        setIsAddHostHidden,
                        deleteHost,
                        editHost,
                        openEditPanel,
                        shareHost,
                        onModalOpen,
                        onModalClose,
                        userRef,
                        isMenuOpen,
                        setIsMenuOpen,
                        isEditHostHidden,
                        isConfirmDeleteHidden,
                        setIsConfirmDeleteHidden,
                    }) {
    const [hosts, setHosts] = useState([]);
    const [filteredHosts, setFilteredHosts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [collapsedFolders, setCollapsedFolders] = useState(new Set());
    const [draggedHost, setDraggedHost] = useState(null);
    const [isDraggingOver, setIsDraggingOver] = useState(null);
    const isMounted = useRef(true);
    const [deletingHostId, setDeletingHostId] = useState(null);
    const [isShareModalHidden, setIsShareModalHidden] = useState(true);
    const [selectedHostForShare, setSelectedHostForShare] = useState(null);
    const [selectedHost, setSelectedHost] = useState(null);
    const [selectedTags, setSelectedTags] = useState(new Set());
    const anchorEl = useRef(null);
    const menuRef = useRef(null);
    const [activeMenuButton, setActiveMenuButton] = useState(null);
    const [lastPinnedHost, setLastPinnedHost] = useState(null);
    const [isPinningInProgress, setIsPinningInProgress] = useState(false);
    const [editingHostId, setEditingHostId] = useState(null);
    const [hostToDelete, setHostToDelete] = useState(null);
    const theme = useTheme();
    const editingTimeoutId = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target) && anchorEl.current && !anchorEl.current.contains(event.target)) {
                setIsMenuOpen(false);
                setSelectedHost(null);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        // Force close menu on ANY click anywhere
        const forceCloseMenuOnClick = () => {
            if (isMenuOpen) {
                setIsMenuOpen(false);
                setSelectedHost(null);
                setActiveMenuButton(null);
                anchorEl.current = null;
            }
        };
        
        window.addEventListener('click', forceCloseMenuOnClick);
        return () => window.removeEventListener('click', forceCloseMenuOnClick);
    }, [isMenuOpen]);

    const fetchHosts = async () => {
        try {
            const savedHosts = await getHosts();
            if (isMounted.current) {
                setHosts(savedHosts || []);
                setFilteredHosts(savedHosts || []);
                setIsLoading(false);
            }
        } catch (error) {
            console.error("Host fetch failed:", error);
            if (isMounted.current) {
                setHosts([]);
                setFilteredHosts([]);
                setIsLoading(false);
            }
        }
    };

    useEffect(() => {
        isMounted.current = true;
        fetchHosts();

        const intervalId = setInterval(() => {
            fetchHosts();
        }, 2000);

        return () => {
            isMounted.current = false;
            clearInterval(intervalId);
        };
    }, []);

    // Make all folders available globally for modals
    useEffect(() => {
        if (hosts.length > 0) {
            const allFolders = hosts
                .map(host => host.config?.folder)
                .filter(Boolean);
            window.availableFolders = Array.from(new Set(allFolders));
            
            // Make sure all hosts have the tags property available 
            // for filtering and display
            hosts.forEach(host => {
                if (!host.tags && host.config?.tags) {
                    host.tags = host.config.tags;
                }
            });
        }
    }, [hosts]);

    useEffect(() => {
        const filtered = hosts.filter((hostWrapper) => {
            const hostConfig = hostWrapper.config || {};
            return hostConfig.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                hostConfig.ip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                hostConfig.folder?.toLowerCase().includes(searchTerm.toLowerCase());
        });
        setFilteredHosts(filtered);
    }, [searchTerm, hosts]);

    useEffect(() => {
        if (!isShareModalHidden) {
            onModalOpen();
        } else {
            onModalClose();
        }
    }, [isShareModalHidden, onModalOpen, onModalClose]);

    const toggleFolder = (folderName) => {
        setCollapsedFolders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(folderName)) {
                newSet.delete(folderName);
            } else {
                newSet.add(folderName);
            }
            return newSet;
        });
    };

    const groupHostsByFolder = (hosts) => {
        const grouped = {};
        const noFolder = [];

        const sortedHosts = [...hosts].sort((a, b) => {
            if (a.isPinned !== b.isPinned) {
                return b.isPinned - a.isPinned;
            }
            const nameA = (a.config?.name || a.config?.ip || '').toLowerCase();
            const nameB = (b.config?.name || b.config?.ip || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        sortedHosts.forEach(host => {
            const folder = host.config?.folder;
            if (folder) {
                if (!grouped[folder]) {
                    grouped[folder] = [];
                }
                grouped[folder].push(host);
            } else {
                noFolder.push(host);
            }
        });

        const sortedFolders = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

        return { grouped, sortedFolders, noFolder };
    };

    const filterHostsByTags = (hosts) => {
        if (selectedTags.size === 0) return hosts;

        return hosts.filter(host => {
            const hostTags = host.tags || host.config?.tags || [];
            return Array.from(selectedTags).every(tag => hostTags.includes(tag));
        });
    };

    const getAllTags = (hosts) => {
        const tags = new Set();
        hosts.forEach(host => {
            const hostTags = host.tags || host.config?.tags || [];
            hostTags.forEach(tag => tags.add(tag));
        });
        return Array.from(tags).sort();
    };

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

    const handleDragStart = (e, host) => {
        setDraggedHost(host);
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

        if (!draggedHost) return;

        if (draggedHost.config.folder === targetFolder) return;

        const newConfig = {
            ...draggedHost.config,
            folder: targetFolder
        };

        try {
            await editHost(draggedHost.config, newConfig);
            await fetchHosts();
        } catch (error) {
            console.error('Failed to update folder:', error);
        }

        setDraggedHost(null);
    };

    const handleDropOnNoFolder = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(null);

        if (!draggedHost || !draggedHost.config.folder) return;

        const newConfig = {
            ...draggedHost.config,
            folder: null
        };

        try {
            await editHost(draggedHost.config, newConfig);
            await fetchHosts();
        } catch (error) {
            console.error('Failed to remove from folder:', error);
        }

        setDraggedHost(null);
    };

    const confirmDelete = async (hostWrapper) => {
        setHostToDelete(hostWrapper);
        setIsConfirmDeleteHidden(false);
        setIsMenuOpen(false);
        onModalOpen();
    };

    const handleDelete = async (e, hostWrapper) => {
        e?.stopPropagation();
        if (deletingHostId === hostWrapper._id) return;

        setDeletingHostId(hostWrapper._id);
        setIsConfirmDeleteHidden(true);
        onModalClose();
        try {
            if (hostWrapper.isOwner) {
                await deleteHost({ _id: hostWrapper._id });
            } else {
                await userRef.current.removeShare(hostWrapper._id);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            await fetchHosts();
        } catch (error) {
            console.error('Failed to delete/remove host:', error);
        } finally {
            setDeletingHostId(null);
            setHostToDelete(null);
        }
    };

    const handleShare = async (hostId, username) => {
        try {
            await shareHost(hostId, username);
            await fetchHosts();
        } catch (error) {
            console.error('Failed to share host:', error);
        }
    };

    const handlePinToggle = async (hostData) => {
        try {
            setIsPinningInProgress(true);
            
            // Create a complete deep copy
            const hostToToggle = JSON.parse(JSON.stringify(hostData));
            const newIsPinned = !hostToToggle.isPinned;
            
            // Track which host is being pinned
            setLastPinnedHost(hostToToggle._id);
            
            // Apply optimistic UI update immediately
            setHosts(prevHosts => 
                prevHosts.map(host => 
                    host._id === hostToToggle._id 
                        ? {...host, isPinned: newIsPinned} 
                        : host
                )
            );
            
            // Create the new config
            const newConfig = {
                ...hostToToggle.config,
                isPinned: newIsPinned
            };
            
            // Directly call socket.io event via userRef to update the database
            if (userRef.current) {
                await new Promise((resolve, reject) => {
                    const userId = userRef.current.getUser()?.id;
                    const sessionToken = userRef.current.getUser()?.sessionToken;
                    
                    if (!userId || !sessionToken) {
                        reject(new Error("Not authenticated"));
                        return;
                    }
                    
                    // This directly calls the socket.io editHost event
                    const socketRef = userRef.current.getSocketRef?.() || window.socketRef;
                    if (socketRef) {
                        socketRef.emit("editHost", {
                            userId,
                            sessionToken,
                            oldHostConfig: hostToToggle.config,
                            newHostConfig: newConfig,
                        }, (response) => {
                            if (response?.success) {
                                resolve(response);
                            } else {
                                reject(new Error(response?.error || "Failed to update pin status"));
                            }
                        });
                    } else {
                        // Fallback to regular editHost if direct socket access isn't available
                        editHost(hostToToggle.config, newConfig)
                            .then(resolve)
                            .catch(reject);
                    }
                });
                
                // Refresh the host list
                await fetchHosts();
                
                console.log(`Successfully ${newIsPinned ? 'pinned' : 'unpinned'} host`);
            }
        } catch (error) {
            console.error('Failed to pin/unpin host:', error);
            
            // Revert the UI change on error
            setHosts(prevHosts => 
                prevHosts.map(host => 
                    host._id === hostToToggle._id 
                        ? {...host, isPinned: hostToToggle.isPinned} 
                        : host
                )
            );
        } finally {
            // Add a small delay before resetting states to ensure UI is updated smoothly
            setTimeout(() => {
                setIsPinningInProgress(false);
                setLastPinnedHost(null);
            }, 500); // 500ms delay for a smoother transition
        }
    };

    const handleEditHost = async (oldConfig, newConfig = null) => {
        try {
            // Clear any existing timeout to prevent early state clearing
            if (editingTimeoutId.current) {
                clearTimeout(editingTimeoutId.current);
                editingTimeoutId.current = null;
            }
            
            if (!oldConfig) {
                console.error("Missing host configuration for edit");
                return;
            }

            // If we have a selected host, use its ID directly
            let hostToEdit = selectedHost;
            
            // If no selected host, try to find the host being edited
            if (!hostToEdit || !hostToEdit._id) {
                hostToEdit = hosts.find(host => 
                    host.config && host.config.ip === oldConfig.ip && 
                    host.config.user === oldConfig.user
                );
            }
            
            // We need the host ID for setting the editing state
            if (!hostToEdit || !hostToEdit._id) {
                console.error("Could not find host ID for editing");
                return;
            }
            
            // Track the host ID being edited
            const editingId = hostToEdit._id;
            
            // Set editing state for the UI
            setEditingHostId(editingId);
            console.log(`Starting edit for host ${hostToEdit.name || hostToEdit.config?.ip} (${editingId})`);
            
            if (!newConfig) {
                // Just open the edit panel - we'll keep the editing state active
                openEditPanel(oldConfig);
                // We don't clear editingHostId here - it will be cleared when the edit is completed
                return;
            }
            
            // Make sure tags are included in newConfig
            if (!newConfig.tags && oldConfig.tags) {
                newConfig.tags = oldConfig.tags;
            }

            // Make sure _id is correctly passed if available
            if (!newConfig._id && oldConfig._id) {
                newConfig._id = oldConfig._id;
            }

            // Apply the edit
            console.log(`Sending edit request to server for host ${hostToEdit.name || hostToEdit.config?.ip}`);
            
            const result = await editHost(oldConfig, newConfig);
            
            // First wait to ensure backend processing completes
            console.log("Initial wait for backend processing...");
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Fetch fresh data after edit
            console.log("Fetching updated host data...");
            await fetchHosts();
            
            // Short wait to allow rendering to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // One final fetch to ensure we have the latest data
            console.log("Final data refresh...");
            await fetchHosts();
            
            // Don't clear immediately, set a longer timeout
            console.log(`Setting a timeout to clear editing state for host ${hostToEdit.name || hostToEdit.config?.ip}`);
            
            // Store the timeout ID so it can be cleared if needed
            editingTimeoutId.current = setTimeout(() => {
                console.log(`Timeout expired, clearing editing state for host ${editingId}`);
                setEditingHostId(null);
                editingTimeoutId.current = null;
            }, 3000); // longer timeout
            
            return result;
        } catch (err) {
            console.error("Edit error:", err);
            // Wait before clearing editing state on error
            await new Promise(resolve => setTimeout(resolve, 500));
            setEditingHostId(null);
            throw err; // Re-throw to allow error handling in the modal
        }
    };

    // Add useEffect to reset editing state when modal is closed
    useEffect(() => {
        // When the edit host modal is hidden/closed, don't immediately clear the editing state
        if (isEditHostHidden && editingHostId !== null) {
            console.log(`Edit modal closed for host ${editingHostId}, but keeping editing state active...`);
            
            // If we already have a timeout running, let it complete naturally
            // The editing state will be cleared by the existing timeout in handleEditHost
            if (!editingTimeoutId.current) {
                // Only if we don't have an active timeout, set a new one
                console.log("No active timeout found, setting a new one");
                editingTimeoutId.current = setTimeout(() => {
                    console.log(`Modal close timeout expired, clearing editing state for host ${editingHostId}`);
                    setEditingHostId(null);
                    editingTimeoutId.current = null;
                }, 2000);
            }
        }
    }, [isEditHostHidden, editingHostId]);

    const renderHostItem = (hostWrapper) => {
        const hostConfig = hostWrapper.config || {};
        const isOwner = hostWrapper.isOwner === true;
        const isMenuActive = activeMenuButton === hostWrapper._id;
        const isPinningThisHost = isPinningInProgress && lastPinnedHost === hostWrapper._id;
        const isEditingThisHost = editingHostId === hostWrapper._id;
        const isThisHostBusy = isPinningThisHost || isEditingThisHost || deletingHostId === hostWrapper._id;

        // Debug info for editing status
        if (isEditingThisHost) {
            console.log(`Host ${hostWrapper._id} (${hostConfig.name || hostConfig.ip}) is being edited`);
        }

        const hostTags = hostWrapper.tags || hostWrapper.config?.tags || [];
        
        if (!hostConfig) {
            return null;
        }

        return (
            <div
                key={hostWrapper._id}
                className={`flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 w-full cursor-grab active:cursor-grabbing hover:border-neutral-500 transition-colors ${draggedHost === hostWrapper ? 'opacity-50' : ''}`}
                draggable={isOwner}
                onDragStart={(e) => isOwner && handleDragStart(e, hostWrapper)}
                onDragEnd={() => setDraggedHost(null)}
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
                                {hostConfig.name || hostConfig.ip}
                            </p>
                            {isThisHostBusy && (
                                <span className="text-xs bg-neutral-600 animate-pulse text-neutral-300 px-2 py-1 rounded flex-shrink-0"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    {deletingHostId === hostWrapper._id ? "Deleting..." : "Updating..."}
                                </span>
                            )}
                            {hostWrapper.isPinned && !isThisHostBusy && (
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
                            {!isOwner && (
                                <span className="text-xs bg-neutral-700 text-neutral-300 px-2 py-1 rounded flex-shrink-0"
                                    style={{ 
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        height: '24px',
                                        lineHeight: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    Shared by {hostWrapper.createdBy?.username}
                                </span>
                            )}
                            {hostTags.map(tag => (
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
                        <p className="text-sm text-gray-400 truncate">
                            {hostConfig.user ? `${hostConfig.user}@${hostConfig.ip}` : `${hostConfig.ip}:${hostConfig.port}`}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <Button
                        variant="outlined"
                        className="text-white"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!hostWrapper.config || !hostWrapper.config.ip || !hostWrapper.config.user) {
                                return;
                            }
                            connectToHost(hostWrapper.config);
                        }}
                        disabled={isThisHostBusy}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isThisHostBusy ? 0.5 : 1,
                            cursor: isThisHostBusy ? "not-allowed" : "pointer",
                            borderColor: "#3d3d3d",
                            borderWidth: "2px",
                            color: "#fff",
                            minWidth: "75px",
                            fontSize: "15px",
                            fontWeight: "bold"
                        }}
                    >
                        Connect
                    </Button>
                    <IconButton
                        variant="outlined"
                        className="text-white"
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedHost(hostWrapper);
                            setActiveMenuButton(hostWrapper._id);
                            setIsMenuOpen(!isMenuOpen);
                            anchorEl.current = e.currentTarget;
                        }}
                        disabled={isThisHostBusy}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isThisHostBusy ? 0.5 : 1,
                            cursor: isThisHostBusy ? "not-allowed" : "pointer",
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

    return (
        <div className="h-full w-full p-4 text-white flex flex-col">
            <div className="flex items-center justify-between mb-2 w-full gap-2">
                <Input
                    placeholder="Search hosts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    sx={{
                        flex: 1,
                        backgroundColor: "#6e6e6e",
                        color: "#fff",
                        "&::placeholder": { color: "#ccc" },
                    }}
                />
                <Button
                    className="text-black"
                    onClick={() => setIsAddHostHidden(false)}
                    sx={{
                        backgroundColor: "#6e6e6e",
                        "&:hover": { backgroundColor: "#0f0f0f" }
                    }}
                >
                    Add Host
                </Button>
            </div>

            {/* Tags Filter */}
            <div className="flex flex-wrap gap-1 mb-2 w-full">
                {getAllTags(hosts).map(tag => (
                    <div
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        style={{ 
                            cursor: 'pointer',
                            backgroundColor: selectedTags.has(tag) ? 'white' : '#2a2a2a',
                            color: selectedTags.has(tag) ? 'black' : 'white',
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
                {isLoading ? (
                    <p className="text-gray-300">Loading hosts...</p>
                ) : filteredHosts.length > 0 ? (
                    <div className="flex flex-col gap-2 w-full" style={{ width: '100%' }}>
                        {(() => {
                            const { grouped, sortedFolders, noFolder } = groupHostsByFolder(filterHostsByTags(filteredHosts));

                            return (
                                <>
                                    {/* No folder container styled the same as folders for consistency */}
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
                                                    {noFolder.map((host) => (
                                                        <div key={host._id || host.id || `host-${Math.random()}`}>
                                                            {renderHostItem(host)}
                                                        </div>
                                                    ))}
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
                                                    {grouped[folderName].map((host) => (
                                                        <div key={host._id || host.id || `host-${Math.random()}`}>
                                                            {renderHostItem(host)}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </>
                            );
                        })()}
                    </div>
                ) : (
                    <p className="text-gray-300">No hosts found.</p>
                )}
            </div>

            {isMenuOpen && selectedHost && (
                <Menu
                    ref={menuRef}
                    open={isMenuOpen}
                    anchorEl={anchorEl.current}
                    onClose={() => setIsMenuOpen(false)}
                    sx={{ backdropFilter: 'blur(30px)' }}
                >
                    {selectedHost.isOwner && (
                        <MenuItem 
                            onClick={(e) => {
                                e.stopPropagation();
                                handleEditHost(selectedHost.config);
                                setIsMenuOpen(false);
                            }}
                        >
                            Edit
                        </MenuItem>
                    )}
                    <MenuItem 
                        onClick={(e) => {
                            e.stopPropagation();
                            handlePinToggle(selectedHost);
                            setIsMenuOpen(false);
                        }}
                    >
                        {selectedHost.isPinned ? 'Unpin' : 'Pin'}
                    </MenuItem>
                    {selectedHost.isOwner && (
                        <MenuItem 
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedHostForShare(selectedHost);
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
                            confirmDelete(selectedHost);
                        }}
                        sx={{ color: '#ef4444' }}
                    >
                        {selectedHost.isOwner ? 'Delete' : 'Remove'}
                    </MenuItem>
                </Menu>
            )}

            {!isShareModalHidden && selectedHostForShare && (
                <ShareHostModal
                    isHidden={isShareModalHidden}
                    setIsHidden={setIsShareModalHidden}
                    handleShare={handleShare}
                    hostConfig={selectedHostForShare}
                />
            )}

            {!isConfirmDeleteHidden && hostToDelete && (
                <ConfirmDeleteModal
                    isHidden={isConfirmDeleteHidden}
                    title={hostToDelete.isOwner ? 'Delete Host' : 'Remove Shared Host'}
                    message={hostToDelete.isOwner ? 
                        'Are you sure you want to delete this host?' : 
                        'Are you sure you want to remove this shared host?'}
                    itemName={hostToDelete.config?.name || hostToDelete.config?.ip}
                    onConfirm={() => handleDelete(null, hostToDelete)}
                    onCancel={() => {
                        setIsConfirmDeleteHidden(true);
                        setHostToDelete(null);
                        onModalClose();
                    }}
                />
            )}
        </div>
    );
}

HostViewer.propTypes = {
    getHosts: PropTypes.func.isRequired,
    connectToHost: PropTypes.func.isRequired,
    setIsAddHostHidden: PropTypes.func.isRequired,
    deleteHost: PropTypes.func.isRequired,
    editHost: PropTypes.func.isRequired,
    openEditPanel: PropTypes.func.isRequired,
    shareHost: PropTypes.func.isRequired,
    onModalOpen: PropTypes.func.isRequired,
    onModalClose: PropTypes.func.isRequired,
    userRef: PropTypes.object,
    isMenuOpen: PropTypes.bool.isRequired,
    setIsMenuOpen: PropTypes.func.isRequired,
    isEditHostHidden: PropTypes.bool,
    isConfirmDeleteHidden: PropTypes.bool,
    setIsConfirmDeleteHidden: PropTypes.func,
};

export default HostViewer;