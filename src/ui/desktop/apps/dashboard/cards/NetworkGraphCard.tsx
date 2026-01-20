import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useReducer,
} from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import {
  getSSHHosts,
  getNetworkTopology,
  saveNetworkTopology,
  type SSHHostWithStatus,
} from "@/ui/main-axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  Move3D,
  ZoomIn,
  ZoomOut,
  RotateCw,
  AlertCircle,
  Download,
  Upload,
  Link2,
  FolderPlus,
  Edit,
  FolderInput,
  FolderMinus,
  Settings2,
  Terminal,
  ArrowUp,
  NetworkIcon,
  FolderOpen,
  Container,
  Server,
  Check,
  ChevronsUpDown,
  ArrowDownUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader";

const AVAILABLE_COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#6b7280", label: "Gray" },
];

interface HostMap {
  [key: string]: SSHHostWithStatus;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetId: string;
  type: "node" | "group" | "edge" | null;
}

interface NetworkGraphCardProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
  embedded?: boolean;
}

export function NetworkGraphCard({
  embedded = true,
}: NetworkGraphCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { addTab } = useTabs();

  const [elements, setElements] = useState<any[]>([]);
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [hostMap, setHostMap] = useState<HostMap>({});
  const hostMapRef = useRef<HostMap>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [showAddNodeDialog, setShowAddNodeDialog] = useState(false);
  const [showAddEdgeDialog, setShowAddEdgeDialog] = useState(false);
  const [showAddGroupDialog, setShowAddGroupDialog] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [showNodeDetail, setShowNodeDetail] = useState(false);
  const [showMoveNodeDialog, setShowMoveNodeDialog] = useState(false);

  const [selectedHostForAddNode, setSelectedHostForAddNode] =
    useState<string>("");
  const [selectedGroupForAddNode, setSelectedGroupForAddNode] =
    useState<string>("ROOT");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGroupForMove, setSelectedGroupForMove] =
    useState<string>("ROOT");
  const [selectedHostForEdge, setSelectedHostForEdge] = useState<string>("");
  const [targetHostForEdge, setTargetHostForEdge] = useState<string>("");
  const [selectedNodeForDetail, setSelectedNodeForDetail] =
    useState<SSHHostWithStatus | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetId: "",
    type: null,
  });

  const [hostComboOpen, setHostComboOpen] = useState(false);
  const [groupComboOpen, setGroupComboOpen] = useState(false);
  const [moveGroupComboOpen, setMoveGroupComboOpen] = useState(false);
  const [sourceComboOpen, setSourceComboOpen] = useState(false);
  const [targetComboOpen, setTargetComboOpen] = useState(false);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const cyRef = useRef<cytoscape.Core | null>(null);
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hostMapRef.current = hostMap;
  }, [hostMap]);

  useEffect(() => {
    loadData();
    const interval = setInterval(updateHostStatuses, 30000);
    statusCheckIntervalRef.current = interval;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
      }
    };
    document.addEventListener("mousedown", handleClickOutside, true);

    return () => {
      if (statusCheckIntervalRef.current)
        clearInterval(statusCheckIntervalRef.current);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const hostsData = await getSSHHosts();
      const hostsArray = Array.isArray(hostsData) ? hostsData : [];
      setHosts(hostsArray);

      const newHostMap: HostMap = {};
      hostsArray.forEach((host) => {
        newHostMap[String(host.id)] = host;
      });
      setHostMap(newHostMap);

      let nodes: any[] = [];
      let edges: any[] = [];

      try {
        const topologyData = await getNetworkTopology();
        if (
          topologyData &&
          topologyData.nodes &&
          Array.isArray(topologyData.nodes)
        ) {
          nodes = topologyData.nodes.map((node: any) => {
            const host = newHostMap[node.data.id];
            return {
              data: {
                id: node.data.id,
                label: host?.name || node.data.label || "Unknown",
                ip: host ? `${host.ip}:${host.port}` : node.data.ip || "",
                status: host?.status || "unknown",
                tags: host?.tags || [],
                parent: node.data.parent,
                color: node.data.color,
              },
              position: node.position || { x: 0, y: 0 },
            };
          });
          edges = topologyData.edges || [];
        }
      } catch (topologyError) {
        console.warn("Starting with empty topology");
      }

      // Validate edges - remove edges that reference non-existent nodes
      const nodeIds = new Set(nodes.map((n: any) => n.data.id));
      const validEdges = edges.filter((edge: any) => {
        const sourceExists = nodeIds.has(edge.data.source);
        const targetExists = nodeIds.has(edge.data.target);
        return sourceExists && targetExists;
      });

      // Add nodes first, then edges to ensure proper order
      setElements([...nodes, ...validEdges]);
    } catch (err) {
      console.error("Failed to load topology:", err);
      setError(t("networkGraph.failedToLoadData"));
    } finally {
      setLoading(false);
    }
  };

  const updateHostStatuses = useCallback(async () => {
    if (!cyRef.current) return;
    try {
      const updatedHosts = await getSSHHosts();
      const updatedHostMap: HostMap = {};
      updatedHosts.forEach((host) => {
        updatedHostMap[String(host.id)] = host;
      });

      cyRef.current.nodes().forEach((node) => {
        if (node.isParent()) return;
        const hostId = node.data("id");
        const updatedHost = updatedHostMap[hostId];
        if (updatedHost) {
          node.data("status", updatedHost.status);
          node.data("tags", updatedHost.tags || []);
        }
      });
      setHostMap(updatedHostMap);
    } catch (err) {
      console.error("Status update failed:", err);
    }
  }, []);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveCurrentLayout();
    }, 1000);
  }, []);

  const saveCurrentLayout = async () => {
    if (!cyRef.current) return;
    try {
      const nodes = cyRef.current.nodes().map((node) => ({
        data: {
          id: node.data("id"),
          label: node.data("label"),
          ip: node.data("ip"),
          status: node.data("status"),
          tags: node.data("tags") || [],
          parent: node.data("parent"),
          color: node.data("color"),
        },
        position: node.position(),
      }));

      const edges = cyRef.current.edges().map((edge) => ({
        data: {
          id: edge.data("id"),
          source: edge.data("source"),
          target: edge.data("target"),
        },
      }));

      await saveNetworkTopology({ nodes, edges });
    } catch (err) {
      console.error("Save failed:", err);
    }
  };

  useEffect(() => {
    if (!cyRef.current || loading || elements.length === 0) return;
    const hasPositions = elements.some(
      (el: any) => el.position && (el.position.x !== 0 || el.position.y !== 0),
    );

    if (!hasPositions) {
      cyRef.current
        .layout({
          name: "cose",
          animate: false,
          randomize: true,
          componentSpacing: 100,
          nodeOverlap: 20,
        })
        .run();
    } else {
      cyRef.current.fit();
    }
  }, [loading]);

  const handleNodeInit = useCallback(
    (cy: cytoscape.Core) => {
      cyRef.current = cy;

      if (!embedded) {
        cy.nodes().forEach((node) => {
          node.grabify();
        });
      } else {
        cy.nodes().forEach((node) => {
          node.ungrabify();
        });
      }

      cy.style()
        .selector("node")
        .style({
          label: "",
          width: "180px",
          height: "90px",
          shape: "round-rectangle",
          "border-width": "0px",
          "background-opacity": 0,
          "background-image": function (ele) {
            const host = ele.data();
            const name = host.label || "";
            const ip = host.ip || "";
            const tags = host.tags || [];
            const isOnline = host.status === "online";
            const isOffline = host.status === "offline";

            const statusColor = isOnline
              ? `rgb(16, 185, 129)`
              : isOffline
                ? `rgb(239, 68, 68)`
                : `rgb(100, 116, 139)`;

            const isDarkMode =
              document.documentElement.classList.contains("dark");
            const bgColor = isDarkMode ? "#09090b" : "#f9fafb";
            const textColor = isDarkMode ? "#f1f5f9" : "#18181b";
            const secondaryTextColor = isDarkMode ? "#94a3b8" : "#64748b";

            const tagsHtml = tags
              .map(
                (t) => `
            <span style="
              background-color:#f97316;
              color:#ffffff;
              padding:2px 8px;
              border-radius:9999px;
              font-size:9px;
              font-weight:700;
              margin:0 2px;
              display:inline-block;
              box-shadow:0 1px 2px rgba(0,0,0,0.3);
            ">${t}</span>`,
              )
              .join("");

            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="90" viewBox="0 0 180 90">
              <defs>
                <filter id="shadow-${ele.id()}" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.25"/>
                </filter>
              </defs>
              <rect x="3" y="3" width="174" height="84" rx="6"
                fill="${bgColor}" stroke="${statusColor}" stroke-width="2" filter="url(#shadow-${ele.id()})"/>
              <foreignObject x="8" y="8" width="164" height="74">
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style="color:${textColor};text-align:center;font-family:sans-serif;
                  height:100%;display:flex;flex-direction:column;justify-content:center;
                  align-items:center;line-height:1.2;">
                  <div style="font-weight:700;font-size:14px;margin-bottom:2px;
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${name}</div>
                  <div style="font-weight:600;font-size:11px;color:${secondaryTextColor};margin-bottom:6px;
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${ip}</div>
                  <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;">
                    ${tagsHtml}
                  </div>
                </div>
              </foreignObject>
            </svg>
          `;
            return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
          },
          "background-fit": "contain",
        })
        .selector("node:parent")
        .style({
          "background-image": "none",
          "background-color": (ele) => ele.data("color") || "#1e3a8a",
          "background-opacity": 0.05,
          "border-color": (ele) => ele.data("color") || "#3b82f6",
          "border-width": "2px",
          "border-style": "dashed",
          label: "data(label)",
          "text-valign": "top",
          "text-halign": "center",
          "text-margin-y": -5,
          color: "#94a3b8",
          "font-size": "16px",
          "font-weight": "bold",
          shape: "round-rectangle",
          padding: "10px",
        })
        .selector("edge")
        .style({
          width: "2px",
          "line-color": "#373739",
          "curve-style": "round-taxi",
          "source-endpoint": "outside-to-node",
          "target-endpoint": "outside-to-node",
          "control-point-step-size": 10,
          "control-point-distances": [40, -40],
          "control-point-weights": [0.2, 0.8],
          "target-arrow-shape": "none",
        })
        .selector("edge:selected")
        .style({
          "line-color": "#3b82f6",
          width: "3px",
        })
        .selector("node:selected")
        .style({
          "overlay-color": "#3b82f6",
          "overlay-opacity": 0.05,
          "overlay-padding": "5px",
        });

      cy.on("tap", "node", (evt) => {
        const node = evt.target;
        setContextMenu((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
        setSelectedEdgeId(null);
        setSelectedNodeId(node.id());
      });

      cy.on("tap", "edge", (evt) => {
        evt.stopPropagation();
        setSelectedEdgeId(evt.target.id());
        setSelectedNodeId(null);
      });

      cy.on("tap", (evt) => {
        if (evt.target === cy) {
          setContextMenu((prev) =>
            prev.visible ? { ...prev, visible: false } : prev,
          );
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        }
      });

      cy.on("cxttap", "node", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const node = evt.target;

        // Check if it's a group by ID prefix or if it's a parent node
        const nodeId = node.id();
        const isGroup = node.isParent() || String(nodeId).startsWith("group-");

        // Don't show context menu for groups in embedded mode
        if (isGroup && embedded) {
          return;
        }

        const x = evt.originalEvent.clientX;
        const y = evt.originalEvent.clientY;

        setContextMenu({
          visible: true,
          x,
          y,
          targetId: nodeId,
          type: isGroup ? "group" : "node",
        });
      });

      cy.on("zoom pan", () => {
        setContextMenu((prev) =>
          prev.visible ? { ...prev, visible: false } : prev,
        );
      });

      cy.on("free", "node", () => !embedded && debouncedSave());

      cy.on("boxselect", "node", () => {
        const selected = cy.$("node:selected");
        if (selected.length === 1) setSelectedNodeId(selected[0].id());
      });
    },
    [debouncedSave, embedded],
  );

  const handleContextAction = (action: string) => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    const targetId = contextMenu.targetId;
    if (!cyRef.current) return;

    if (action === "details") {
      const host = hostMap[targetId];
      if (host) {
        setSelectedNodeForDetail(host);
        setShowNodeDetail(true);
      }
    } else if (action === "connect") {
      const host = hostMap[targetId];
      if (host) {
        const title = host.name?.trim()
          ? host.name
          : `${host.username}@${host.ip}:${host.port}`;
        addTab({ type: "terminal", title, hostConfig: host });
      }
    } else if (action === "move") {
      setSelectedNodeId(targetId);
      const node = cyRef.current.$id(targetId);
      const parentId = node.data("parent");
      setSelectedGroupForMove(parentId || "ROOT");
      setShowMoveNodeDialog(true);
    } else if (action === "removeFromGroup") {
      const node = cyRef.current.$id(targetId);
      node.move({ parent: null });
      debouncedSave();
    } else if (action === "editGroup") {
      const node = cyRef.current.$id(targetId);
      setEditingGroupId(targetId);
      setNewGroupName(node.data("label"));
      setNewGroupColor(node.data("color") || "#3b82f6");
      setShowEditGroupDialog(true);
    } else if (action === "addHostToGroup") {
      setSelectedGroupForAddNode(targetId);
      setSelectedHostForAddNode("");
      setShowAddNodeDialog(true);
    } else if (action === "delete") {
      cyRef.current.$id(targetId).remove();
      debouncedSave();
    }
  };

  const handleConnectAction = (appType: string) => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    const host = hostMap[contextMenu.targetId];
    if (!host) return;

    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;

    addTab({ type: appType, title, hostConfig: host });
  };

  const hasTunnelConnections = (host: SSHHostWithStatus | undefined) => {
    if (!host?.tunnelConnections) return false;
    try {
      const tunnelConnections = Array.isArray(host.tunnelConnections)
        ? host.tunnelConnections
        : JSON.parse(host.tunnelConnections);
      return Array.isArray(tunnelConnections) && tunnelConnections.length > 0;
    } catch {
      return false;
    }
  };

  const handleAddNode = () => {
    setSelectedHostForAddNode("");
    setSelectedGroupForAddNode("ROOT");
    setShowAddNodeDialog(true);
  };

  const handleConfirmAddNode = async () => {
    if (!cyRef.current || !selectedHostForAddNode) return;
    try {
      if (cyRef.current.$id(selectedHostForAddNode).length > 0) {
        setError(t("networkGraph.hostAlreadyExists"));
        return;
      }
      const host = hostMap[selectedHostForAddNode];
      const parent =
        selectedGroupForAddNode === "ROOT"
          ? undefined
          : selectedGroupForAddNode;

      const newNode = {
        data: {
          id: selectedHostForAddNode,
          label: host.name || `${host.ip}`,
          ip: `${host.ip}:${host.port}`,
          status: host.status,
          tags: host.tags || [],
          parent: parent,
        },
        position: { x: 100 + Math.random() * 50, y: 100 + Math.random() * 50 },
      };
      cyRef.current.add(newNode);
      await saveCurrentLayout();
      setElements([...cyRef.current.elements().jsons()]);
      forceUpdate();
      setShowAddNodeDialog(false);
    } catch (err) {
      setError(t("networkGraph.failedToAddNode"));
    }
  };

  const handleAddGroup = async () => {
    if (!cyRef.current || !newGroupName) return;
    const groupId = `group-${Date.now()}`;
    cyRef.current.add({
      data: { id: groupId, label: newGroupName, color: newGroupColor },
    });
    await saveCurrentLayout();
    setElements([...cyRef.current.elements().jsons()]);
    forceUpdate();
    setShowAddGroupDialog(false);
    setNewGroupName("");
  };

  const handleUpdateGroup = async () => {
    if (!cyRef.current || !editingGroupId || !newGroupName) return;
    const group = cyRef.current.$id(editingGroupId);
    group.data("label", newGroupName);
    group.data("color", newGroupColor);
    await saveCurrentLayout();
    setShowEditGroupDialog(false);
    setEditingGroupId(null);
  };

  const handleMoveNodeToGroup = async () => {
    if (!cyRef.current || !selectedNodeId) return;
    const node = cyRef.current.$id(selectedNodeId);
    const parent =
      selectedGroupForMove === "ROOT" ? null : selectedGroupForMove;
    node.move({ parent: parent });
    await saveCurrentLayout();
    setShowMoveNodeDialog(false);
  };

  const handleAddEdge = async () => {
    if (!cyRef.current || !selectedHostForEdge || !targetHostForEdge) return;
    if (selectedHostForEdge === targetHostForEdge)
      return setError(t("networkGraph.sourceDifferentFromTarget"));

    const edgeId = `${selectedHostForEdge}-${targetHostForEdge}`;
    if (cyRef.current.$id(edgeId).length > 0)
      return setError(t("networkGraph.connectionExists"));

    cyRef.current.add({
      data: {
        id: edgeId,
        source: selectedHostForEdge,
        target: targetHostForEdge,
      },
    });
    await saveCurrentLayout();
    setShowAddEdgeDialog(false);
  };

  const handleRemoveSelected = () => {
    if (!cyRef.current) return;

    if (selectedNodeId) {
      cyRef.current.$id(selectedNodeId).remove();
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      cyRef.current.$id(selectedEdgeId).remove();
      setSelectedEdgeId(null);
    }

    debouncedSave();
  };

  const availableGroups = useMemo(() => {
    return elements
      .filter(
        (el) => !el.data.source && !el.data.target && !el.data.ip && el.data.id,
      )
      .map((el) => ({ id: el.data.id, label: el.data.label }));
  }, [elements]);

  const availableNodesForConnection = useMemo(() => {
    return elements
      .filter((el) => !el.data.source && !el.data.target)
      .map((el) => ({
        id: el.data.id,
        label: el.data.label,
      }));
  }, [elements]);

  const availableHostsForAdd = useMemo(() => {
    if (!cyRef.current) return hosts;
    const existingIds = new Set(elements.map((e) => e.data.id));
    return hosts.filter((h) => !existingIds.has(String(h.id)));
  }, [hosts, elements]);

  const handleOpenInNewTab = () => {
    addTab({
      type: "network_graph",
      title: t("dashboard.networkGraph"),
    });
  };

  if (!embedded) {
    return (
      <div className="h-full w-full flex flex-col bg-canvas p-4">
        <div className="flex flex-row items-center justify-between mb-3">
          <p className="text-xl font-semibold">{t("dashboard.networkGraph")}</p>
        </div>

        <AlertDialog open={!!error} onOpenChange={() => setError(null)}>
          <AlertDialogContent className="bg-canvas border-2 border-edge">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <AlertDialogDescription className="text-foreground flex-1">
                {error}
              </AlertDialogDescription>
            </div>
            <div className="flex justify-end">
              <AlertDialogAction onClick={() => setError(null)}>
                OK
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddNode}
              title={t("networkGraph.addHost")}
              className="h-8 px-2"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("networkGraph.addHost")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNewGroupName("");
                setNewGroupColor("#3b82f6");
                setShowAddGroupDialog(true);
              }}
              title={t("networkGraph.addGroup")}
              className="h-8 px-2"
            >
              <FolderPlus className="w-4 h-4 mr-1" />
              {t("networkGraph.addGroup")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddEdgeDialog(true)}
              title={t("networkGraph.addLink")}
              className="h-8 px-2"
            >
              <Link2 className="w-4 h-4 mr-1" />
              {t("networkGraph.addLink")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveSelected}
              disabled={!selectedNodeId && !selectedEdgeId}
              title={t("networkGraph.deleteSelected")}
              className="h-8 px-2 text-red-400 hover:text-red-300 disabled:opacity-30"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="w-px h-6 bg-border" />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}
              title={t("networkGraph.zoomIn")}
              className="h-8 w-8 p-0"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}
              title={t("networkGraph.zoomOut")}
              className="h-8 w-8 p-0"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cyRef.current?.fit()}
              title={t("networkGraph.resetView")}
              className="h-8 w-8 p-0"
            >
              <RotateCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="w-px h-6 bg-border" />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!cyRef.current) return;
                const json = JSON.stringify(
                  cyRef.current.json().elements,
                  null,
                  2,
                );
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "network.json";
                a.click();
              }}
              title={t("networkGraph.exportJSON")}
              className="h-8 w-8 p-0"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title={t("networkGraph.importJSON")}
              className="h-8 w-8 p-0"
            >
              <Upload className="w-4 h-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (evt) => {
                  try {
                    const json = JSON.parse(evt.target?.result as string);
                    await saveNetworkTopology({
                      nodes: json.nodes,
                      edges: json.edges,
                    });
                    await loadData();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  } catch (err) {
                    setError(t("networkGraph.invalidFile"));
                  }
                };
                reader.readAsText(file);
              }}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative rounded-md border-2 border-edge">
          <SimpleLoader
            visible={loading}
            backgroundColor="rgba(0, 0, 0, 0.5)"
            className="z-10"
          />

          {contextMenu.visible && (
            <div
              ref={contextMenuRef}
              className="fixed z-[200] min-w-[180px] rounded-md shadow-2xl p-1 flex flex-col gap-0.5 bg-canvas border-2 border-edge"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              {contextMenu.type === "node" && (
                <>
                  {hostMap[contextMenu.targetId]?.enableTerminal && (
                    <button
                      onClick={() => handleConnectAction("terminal")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      {t("networkGraph.terminal")}
                    </button>
                  )}
                  {hostMap[contextMenu.targetId]?.enableFileManager && (
                    <button
                      onClick={() => handleConnectAction("file_manager")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t("networkGraph.fileManager")}
                    </button>
                  )}
                  {hostMap[contextMenu.targetId]?.enableTunnel &&
                    hasTunnelConnections(hostMap[contextMenu.targetId]) && (
                      <button
                        onClick={() => handleConnectAction("tunnel")}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                      >
                        <ArrowDownUp className="w-3.5 h-3.5" />
                        {t("networkGraph.tunnel")}
                      </button>
                    )}
                  {hostMap[contextMenu.targetId]?.enableDocker && (
                    <button
                      onClick={() => handleConnectAction("docker")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <Container className="w-3.5 h-3.5" />
                      {t("networkGraph.docker")}
                    </button>
                  )}
                  <button
                    onClick={() => handleConnectAction("server_stats")}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                  >
                    <Server className="w-3.5 h-3.5" />
                    {t("networkGraph.serverStats")}
                  </button>

                  {!embedded && (
                    <>
                      <div className="h-px my-1 bg-border" />
                      <button
                        onClick={() => handleContextAction("move")}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                      >
                        <FolderInput className="w-3.5 h-3.5" />
                        {t("networkGraph.moveToGroup")}
                      </button>
                      {cyRef.current?.$id(contextMenu.targetId).parent()
                        .length ? (
                        <button
                          onClick={() => handleContextAction("removeFromGroup")}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                        >
                          <FolderMinus className="w-3.5 h-3.5" />
                          {t("networkGraph.removeFromGroup")}
                        </button>
                      ) : null}
                      <div className="h-px my-1 bg-border" />
                      <button
                        onClick={() => handleContextAction("delete")}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-red-400 hover:text-red-300 text-left w-full transition-colors hover:bg-red-950/30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t("networkGraph.delete")}
                      </button>
                    </>
                  )}
                </>
              )}

              {contextMenu.type === "group" && !embedded && (
                <>
                  <button
                    onClick={() => handleContextAction("addHostToGroup")}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    {t("networkGraph.addHostHere")}
                  </button>
                  <button
                    onClick={() => handleContextAction("editGroup")}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    {t("networkGraph.editGroup")}
                  </button>
                  <div className="h-px my-1 bg-border" />
                  <button
                    onClick={() => handleContextAction("delete")}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-red-400 hover:text-red-300 text-left w-full transition-colors hover:bg-red-950/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("networkGraph.delete")}
                  </button>
                </>
              )}
            </div>
          )}

          <CytoscapeComponent
            elements={elements}
            style={{ width: "100%", height: "100%" }}
            layout={{ name: "preset" }}
            cy={handleNodeInit}
            wheelSensitivity={2.0}
            minZoom={0.2}
            maxZoom={3}
          />
        </div>

        <Dialog open={showAddNodeDialog} onOpenChange={setShowAddNodeDialog}>
          <DialogContent className="bg-canvas border-2 border-edge">
            <DialogHeader>
              <DialogTitle>{t("networkGraph.addHost")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{t("networkGraph.selectHost")}</Label>
                <Popover open={hostComboOpen} onOpenChange={setHostComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={hostComboOpen}
                      className="justify-between border-2 border-edge"
                    >
                      {selectedHostForAddNode ? (
                        <div className="flex flex-col items-start">
                          <span>
                            {availableHostsForAdd.find(
                              (h) => String(h.id) === selectedHostForAddNode,
                            )?.name ||
                              availableHostsForAdd.find(
                                (h) => String(h.id) === selectedHostForAddNode,
                              )?.ip}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {
                              availableHostsForAdd.find(
                                (h) => String(h.id) === selectedHostForAddNode,
                              )?.username
                            }
                            @
                            {
                              availableHostsForAdd.find(
                                (h) => String(h.id) === selectedHostForAddNode,
                              )?.ip
                            }
                            :
                            {
                              availableHostsForAdd.find(
                                (h) => String(h.id) === selectedHostForAddNode,
                              )?.port
                            }
                          </span>
                        </div>
                      ) : (
                        t("networkGraph.chooseHost")
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-canvas border-2 border-edge"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("networkGraph.searchHost")}
                      />
                      <CommandEmpty>
                        {t("networkGraph.noHostFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableHostsForAdd.map((h) => (
                          <CommandItem
                            key={h.id}
                            value={String(h.id)}
                            onSelect={() => {
                              setSelectedHostForAddNode(String(h.id));
                              setHostComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedHostForAddNode === String(h.id)
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{h.name || h.ip}</span>
                              <span className="text-xs text-muted-foreground">
                                {h.username}@{h.ip}:{h.port}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label>{t("networkGraph.parentGroup")}</Label>
                <Popover open={groupComboOpen} onOpenChange={setGroupComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={groupComboOpen}
                      className="justify-between border-2 border-edge"
                    >
                      {selectedGroupForAddNode === "ROOT"
                        ? t("networkGraph.noGroup")
                        : availableGroups.find(
                            (g) => g.id === selectedGroupForAddNode,
                          )?.label}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-canvas border-2 border-edge"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("networkGraph.searchGroup")}
                      />
                      <CommandEmpty>
                        {t("networkGraph.noGroupFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="ROOT"
                          onSelect={() => {
                            setSelectedGroupForAddNode("ROOT");
                            setGroupComboOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedGroupForAddNode === "ROOT"
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {t("networkGraph.noGroup")}
                        </CommandItem>
                        {availableGroups.map((g) => (
                          <CommandItem
                            key={g.id}
                            value={g.id}
                            onSelect={() => {
                              setSelectedGroupForAddNode(g.id);
                              setGroupComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedGroupForAddNode === g.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {g.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowAddNodeDialog(false)}
                className="border-2 border-edge"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleConfirmAddNode}
                disabled={!selectedHostForAddNode}
              >
                {t("common.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showAddGroupDialog || showEditGroupDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowAddGroupDialog(false);
              setShowEditGroupDialog(false);
            }
          }}
        >
          <DialogContent className="bg-canvas border-2 border-edge">
            <DialogHeader>
              <DialogTitle>
                {showEditGroupDialog
                  ? t("networkGraph.editGroup")
                  : t("networkGraph.createGroup")}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{t("networkGraph.groupName")}</Label>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t("networkGraph.groupName")}
                  className="border-2 border-edge"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("networkGraph.color")}</Label>
                <div className="grid grid-cols-4 gap-2">
                  {AVAILABLE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setNewGroupColor(color.value)}
                      className={cn(
                        "h-10 rounded border-2 transition-all",
                        newGroupColor === color.value
                          ? "border-primary ring-2 ring-primary"
                          : "border-edge hover:border-muted",
                      )}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddGroupDialog(false);
                  setShowEditGroupDialog(false);
                }}
                className="border-2 border-edge"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={
                  showEditGroupDialog ? handleUpdateGroup : handleAddGroup
                }
                disabled={!newGroupName}
              >
                {showEditGroupDialog ? t("common.update") : t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showMoveNodeDialog} onOpenChange={setShowMoveNodeDialog}>
          <DialogContent className="bg-canvas border-2 border-edge">
            <DialogHeader>
              <DialogTitle>{t("networkGraph.moveToGroup")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{t("networkGraph.selectGroup")}</Label>
                <Popover
                  open={moveGroupComboOpen}
                  onOpenChange={setMoveGroupComboOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={moveGroupComboOpen}
                      className="justify-between border-2 border-edge"
                    >
                      {selectedGroupForMove === "ROOT"
                        ? t("networkGraph.noGroup")
                        : availableGroups.find(
                            (g) => g.id === selectedGroupForMove,
                          )?.label}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-canvas border-2 border-edge"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("networkGraph.searchGroup")}
                      />
                      <CommandEmpty>
                        {t("networkGraph.noGroupFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="ROOT"
                          onSelect={() => {
                            setSelectedGroupForMove("ROOT");
                            setMoveGroupComboOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedGroupForMove === "ROOT"
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {t("networkGraph.noGroup")}
                        </CommandItem>
                        {availableGroups.map((g) => (
                          <CommandItem
                            key={g.id}
                            value={g.id}
                            disabled={g.id === selectedNodeId}
                            onSelect={() => {
                              if (g.id !== selectedNodeId) {
                                setSelectedGroupForMove(g.id);
                                setMoveGroupComboOpen(false);
                              }
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedGroupForMove === g.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {g.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowMoveNodeDialog(false)}
                className="border-2 border-edge"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleMoveNodeToGroup}>
                {t("networkGraph.move")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showAddEdgeDialog} onOpenChange={setShowAddEdgeDialog}>
          <DialogContent className="bg-canvas border-2 border-edge">
            <DialogHeader>
              <DialogTitle>{t("networkGraph.addConnection")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{t("networkGraph.source")}</Label>
                <Popover
                  open={sourceComboOpen}
                  onOpenChange={setSourceComboOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={sourceComboOpen}
                      className="justify-between border-2 border-edge"
                    >
                      {selectedHostForEdge
                        ? availableNodesForConnection.find(
                            (el) => el.id === selectedHostForEdge,
                          )?.label
                        : t("networkGraph.selectSourcePlaceholder")}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-canvas border-2 border-edge"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("networkGraph.searchNode")}
                      />
                      <CommandEmpty>
                        {t("networkGraph.noNodeFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableNodesForConnection.map((el) => (
                          <CommandItem
                            key={el.id}
                            value={el.id}
                            onSelect={() => {
                              setSelectedHostForEdge(el.id);
                              setSourceComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedHostForEdge === el.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {el.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Label>{t("networkGraph.target")}</Label>
                <Popover
                  open={targetComboOpen}
                  onOpenChange={setTargetComboOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={targetComboOpen}
                      className="justify-between border-2 border-edge"
                    >
                      {targetHostForEdge
                        ? availableNodesForConnection.find(
                            (el) => el.id === targetHostForEdge,
                          )?.label
                        : t("networkGraph.selectTargetPlaceholder")}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-canvas border-2 border-edge"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("networkGraph.searchNode")}
                      />
                      <CommandEmpty>
                        {t("networkGraph.noNodeFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableNodesForConnection.map((el) => (
                          <CommandItem
                            key={el.id}
                            value={el.id}
                            onSelect={() => {
                              setTargetHostForEdge(el.id);
                              setTargetComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                targetHostForEdge === el.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {el.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowAddEdgeDialog(false)}
                className="border-2 border-edge"
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleAddEdge}>
                {t("networkGraph.connect")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showNodeDetail} onOpenChange={setShowNodeDetail}>
          <DialogContent className="bg-canvas border-2 border-edge">
            <DialogHeader>
              <DialogTitle>{t("networkGraph.hostDetails")}</DialogTitle>
            </DialogHeader>
            {selectedNodeForDetail && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="font-semibold">
                    {t("networkGraph.name")}:
                  </span>
                  <span>{selectedNodeForDetail.name}</span>
                  <span className="font-semibold">{t("networkGraph.ip")}:</span>
                  <span>{selectedNodeForDetail.ip}</span>
                  <span className="font-semibold">
                    {t("networkGraph.status")}:
                  </span>
                  <span className="text-sm capitalize">
                    {selectedNodeForDetail.status || t("networkGraph.unknown")}
                  </span>
                  <span className="font-semibold">{t("networkGraph.id")}:</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedNodeForDetail.id}
                  </span>
                </div>
                {selectedNodeForDetail.tags &&
                  selectedNodeForDetail.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {selectedNodeForDetail.tags.map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="text-xs border-2 border-edge"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowNodeDetail(false)}
                className="border-2 border-edge"
              >
                {t("common.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
        <div className="flex flex-row items-center justify-between mb-3 mt-1">
          <p className="text-xl font-semibold flex flex-row items-center">
            <NetworkIcon className="mr-3" />
            {t("dashboard.networkGraph")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenInNewTab}
            className="flex items-center gap-2 h-8"
            title={t("common.openInNewTab")}
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
        </div>

        <AlertDialog open={!!error} onOpenChange={() => setError(null)}>
          <AlertDialogContent className="bg-canvas border-2 border-edge">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <AlertDialogDescription className="text-foreground flex-1">
                {error}
              </AlertDialogDescription>
            </div>
            <div className="flex justify-end">
              <AlertDialogAction onClick={() => setError(null)}>
                OK
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex-1 overflow-hidden relative rounded-md border-2 border-edge">
          <SimpleLoader
            visible={loading}
            backgroundColor="rgba(0, 0, 0, 0.5)"
            className="z-10"
          />

          {contextMenu.visible && (
            <div
              ref={contextMenuRef}
              className="fixed z-[200] min-w-[180px] rounded-md shadow-2xl p-1 flex flex-col gap-0.5 bg-canvas border-2 border-edge"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              {contextMenu.type === "node" && (
                <>
                  {hostMap[contextMenu.targetId]?.enableTerminal && (
                    <button
                      onClick={() => handleConnectAction("terminal")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      {t("networkGraph.terminal")}
                    </button>
                  )}
                  {hostMap[contextMenu.targetId]?.enableFileManager && (
                    <button
                      onClick={() => handleConnectAction("file_manager")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t("networkGraph.fileManager")}
                    </button>
                  )}
                  {hostMap[contextMenu.targetId]?.enableTunnel &&
                    hasTunnelConnections(hostMap[contextMenu.targetId]) && (
                      <button
                        onClick={() => handleConnectAction("tunnel")}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                      >
                        <ArrowDownUp className="w-3.5 h-3.5" />
                        {t("networkGraph.tunnel")}
                      </button>
                    )}
                  {hostMap[contextMenu.targetId]?.enableDocker && (
                    <button
                      onClick={() => handleConnectAction("docker")}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                    >
                      <Container className="w-3.5 h-3.5" />
                      {t("networkGraph.docker")}
                    </button>
                  )}
                  <button
                    onClick={() => handleConnectAction("server_stats")}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors hover:bg-muted"
                  >
                    <Server className="w-3.5 h-3.5" />
                    {t("networkGraph.serverStats")}
                  </button>
                </>
              )}
            </div>
          )}

          <CytoscapeComponent
            elements={elements}
            style={{ width: "100%", height: "100%" }}
            layout={{ name: "preset" }}
            cy={handleNodeInit}
            wheelSensitivity={2.0}
            minZoom={0.2}
            maxZoom={3}
          />
        </div>
      </div>
    </div>
  );
}
