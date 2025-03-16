import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button, Input } from "@mui/joy";

function HostViewer({ getHosts, connectToHost, setIsAddHostHidden, deleteHost, editHost, openEditPanel }) {
    const [hosts, setHosts] = useState([]);
    const [filteredHosts, setFilteredHosts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [collapsedFolders, setCollapsedFolders] = useState(new Set());
    const [draggedHost, setDraggedHost] = useState(null);
    const [isDraggingOver, setIsDraggingOver] = useState(null);
    const isMounted = useRef(true);
    const [isDeleting, setIsDeleting] = useState(false);

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

    useEffect(() => {
        const filtered = hosts.filter((hostWrapper) => {
            const hostConfig = hostWrapper.config || {};
            return hostConfig.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                   hostConfig.ip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                   hostConfig.folder?.toLowerCase().includes(searchTerm.toLowerCase());
        });
        setFilteredHosts(filtered);
    }, [searchTerm, hosts]);

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
        if (isDeleting) return;
        
        setIsDeleting(true);
        try {
            await deleteHost({ _id: hostWrapper._id });
            await new Promise(resolve => setTimeout(resolve, 500)); // Add a small delay for UX
            await fetchHosts();
        } catch (error) {
            console.error('Failed to delete host:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const renderHostItem = (hostWrapper) => {
        const hostConfig = hostWrapper.config || {};

        if (!hostConfig) {
            return null;
        }

        return (
            <div
                key={hostWrapper._id}
                className={`flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 w-full cursor-grab active:cursor-grabbing hover:border-neutral-500 transition-colors ${draggedHost === hostWrapper ? 'opacity-50' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, hostWrapper)}
                onDragEnd={() => setDraggedHost(null)}
            >
                <div className="flex items-center gap-2 flex-1">
                    <div className="text-neutral-500 cursor-grab active:cursor-grabbing">⋮⋮</div>
                    <div>
                        <p className="font-semibold">{hostConfig.name || hostConfig.ip}</p>
                        <p className="text-sm text-gray-400">
                            {hostConfig.user ? `${hostConfig.user}@${hostConfig.ip}` : `${hostConfig.ip}:${hostConfig.port}`}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button
                        className="text-black"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!hostWrapper.config || !hostWrapper.config.ip || !hostWrapper.config.user) {
                                return;
                            }
                            connectToHost(hostWrapper.config);
                        }}
                        disabled={isDeleting}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isDeleting ? 0.5 : 1,
                            cursor: isDeleting ? "not-allowed" : "pointer"
                        }}
                    >
                        Connect
                    </Button>
                    <Button
                        className="text-black"
                        onClick={(e) => handleDelete(e, hostWrapper)}
                        disabled={isDeleting}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isDeleting ? 0.5 : 1,
                            cursor: isDeleting ? "not-allowed" : "pointer"
                        }}
                    >
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                    <Button
                        className="text-black"
                        onClick={(e) => {
                            e.stopPropagation();
                            openEditPanel(hostConfig);
                        }}
                        disabled={isDeleting}
                        sx={{
                            backgroundColor: "#6e6e6e",
                            "&:hover": { backgroundColor: "#0f0f0f" },
                            opacity: isDeleting ? 0.5 : 1,
                            cursor: isDeleting ? "not-allowed" : "pointer"
                        }}
                    >
                        Edit
                    </Button>
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
            <div className="flex-grow overflow-auto">
                {isLoading ? (
                    <p className="text-gray-300">Loading hosts...</p>
                ) : filteredHosts.length > 0 ? (
                    <div className="flex flex-col gap-2 w-full">
                        {(() => {
                            const { grouped, sortedFolders, noFolder } = groupHostsByFolder(filteredHosts);

                            return (
                                <>
                                    {/* Render hosts without folders first */}
                                    <div
                                        className={`flex flex-col gap-2 p-2 rounded-lg transition-colors ${isDraggingOver === 'no-folder' ? 'bg-neutral-700' : ''}`}
                                        onDragOver={(e) => handleDragOver(e, 'no-folder')}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDropOnNoFolder}
                                    >
                                        {noFolder.map((host) => renderHostItem(host))}
                                    </div>

                                    {/* Render folders and their hosts */}
                                    {sortedFolders.map((folderName) => (
                                        <div key={folderName} className="mb-2">
                                            <div
                                                className={`flex items-center gap-2 p-2 bg-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-500 transition-colors ${
                                                    isDraggingOver === folderName ? 'bg-neutral-500 border-2 border-dashed border-neutral-400' : ''
                                                }`}
                                                onClick={() => toggleFolder(folderName)}
                                                onDragOver={(e) => handleDragOver(e, folderName)}
                                                onDragLeave={handleDragLeave}
                                                onDrop={(e) => handleDrop(e, folderName)}
                                            >
                                                <span className={`font-bold w-4 text-center transition-transform ${collapsedFolders.has(folderName) ? 'rotate-[-90deg]' : ''}`}>
                                                    ▼
                                                </span>
                                                <span className="font-bold">{folderName}</span>
                                                <span className="text-sm text-gray-300">
                                                    ({grouped[folderName].length})
                                                </span>
                                            </div>
                                            {!collapsedFolders.has(folderName) && (
                                                <div className="ml-6 mt-2 flex flex-col gap-2">
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
                    <p className="text-gray-300">No hosts available...</p>
                )}
            </div>
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
};

export default HostViewer;