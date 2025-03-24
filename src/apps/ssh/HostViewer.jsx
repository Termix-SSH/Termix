import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button, Input, Menu, MenuItem, IconButton, Chip } from "@mui/joy";
import ShareHostModal from "../../modals/ShareHostModal";
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
    const theme = useTheme();

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

    const handleDelete = async (e, hostWrapper) => {
        e.stopPropagation();
        if (deletingHostId === hostWrapper._id) return;

        setDeletingHostId(hostWrapper._id);
        setIsMenuOpen(false);
        try {
            const isOwner = hostWrapper.createdBy?._id === userRef.current?.getUser()?.id;
            if (isOwner) {
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
            if (!oldConfig) {
                return;
            }

            if (!newConfig) {
                openEditPanel(oldConfig);
                return;
            }
            
            // Find the host being edited to track its ID
            const hostToEdit = hosts.find(host => 
                host.config && host.config.ip === oldConfig.ip && 
                host.config.user === oldConfig.user
            );
            
            if (hostToEdit) {
                // Set editing state synchronously 
                setEditingHostId(hostToEdit._id);
                
                // Make sure tags are included in newConfig
                if (!newConfig.tags && oldConfig.tags) {
                    newConfig.tags = oldConfig.tags;
                }

                // Apply the edit and fetch hosts
                await editHost(oldConfig, newConfig);
                await fetchHosts();

                // Keep the editing indicator visible for a moment to provide feedback
                setTimeout(() => {
                    setEditingHostId(null);
                }, 1500);
            } else {
                console.log("Host not found for editing");
                await editHost(oldConfig, newConfig);
            }
        } catch (err) {
            console.error("Edit error:", err);
            setEditingHostId(null);
        }
    };

    const renderHostItem = (hostWrapper) => {
        const hostConfig = hostWrapper.config || {};
        const isOwner = hostWrapper.createdBy?._id === userRef.current?.getUser()?.id;
        const isMenuActive = activeMenuButton === hostWrapper._id;
        const isPinningThisHost = isPinningInProgress && lastPinnedHost === hostWrapper._id;
        const isEditingThisHost = editingHostId === hostWrapper._id;
        const isThisHostBusy = isPinningThisHost || isEditingThisHost || deletingHostId === hostWrapper._id;

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
                            setIsMenuOpen(true);
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
                    <Chip
                        key={tag}
                        variant={selectedTags.has(tag) ? "solid" : "outlined"}
                        color="neutral"
                        onClick={() => toggleTag(tag)}
                        sx={{ 
                            cursor: 'pointer',
                            backgroundColor: selectedTags.has(tag) ? theme.palette.general.primary : '#2a2a2a',
                            borderColor: theme.palette.general.primary,
                            color: selectedTags.has(tag) ? '#fff' : theme.palette.general.primary,
                            '&:hover': {
                                backgroundColor: selectedTags.has(tag) 
                                    ? theme.palette.general.dark 
                                    : '#3d3d3d'
                            }
                        }}
                    >
                        {tag}
                    </Chip>
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
                                                    {noFolder.map((host) => renderHostItem(host))}
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
                                                    {grouped[folderName].map((host) => renderHostItem(host))}
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
                    {selectedHost.createdBy?._id === userRef.current?.getUser()?.id && (
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
                    {selectedHost.createdBy?._id === userRef.current?.getUser()?.id && (
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
                        onClick={(e) => handleDelete(e, selectedHost)}
                        sx={{ color: '#ef4444' }}
                    >
                        {selectedHost.createdBy?._id === userRef.current?.getUser()?.id ? 'Delete' : 'Remove'}
                    </MenuItem>
                </Menu>
            )}

            {!isShareModalHidden && selectedHostForShare && (
                <ShareHostModal
                    hostId={selectedHostForShare._id}
                    onClose={() => {
                        setIsShareModalHidden(true);
                        setSelectedHostForShare(null);
                    }}
                    onShare={handleShare}
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
};

export default HostViewer;