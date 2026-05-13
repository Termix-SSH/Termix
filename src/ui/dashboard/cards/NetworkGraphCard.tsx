import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useReducer,
} from "react";
import { Card } from "@/components/card";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import {
  getSSHHosts,
  getNetworkTopology,
  saveNetworkTopology,
  type SSHHostWithStatus,
  type NetworkTopologyEdge,
  type NetworkTopologyNode,
} from "@/main-axios";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import {
  Plus,
  Trash2,
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
  Terminal,
  ArrowUp,
  Network,
  FolderOpen,
  Container,
  Server,
  Check,
  ChevronsUpDown,
  ArrowDownUp,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabsSafe } from "@/shell/TabContext";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import { cn } from "@/lib/utils";

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
  onOpenInNewTab?: () => void;
}

type NetworkElement = NetworkTopologyNode | NetworkTopologyEdge;

function buildNodeSvg(
  name: string,
  ip: string,
  tags: string[],
  status: string,
): string {
  const isOnline = status === "online";
  const isOffline = status === "offline";
  const statusColor = isOnline
    ? "rgb(16,185,129)"
    : isOffline
      ? "rgb(239,68,68)"
      : "rgb(100,116,139)";

  const isDark =
    document.documentElement.classList.contains("dark") ||
    document.documentElement.classList.contains("dracula") ||
    document.documentElement.classList.contains("catppuccin") ||
    document.documentElement.classList.contains("nord") ||
    document.documentElement.classList.contains("solarized") ||
    document.documentElement.classList.contains("tokyo-night") ||
    document.documentElement.classList.contains("one-dark") ||
    document.documentElement.classList.contains("gruvbox");

  const bg = isDark ? "#1c1c1e" : "#ffffff";
  const border = isDark ? "#2a2a2c" : "#e5e7eb";
  const textPrimary = isDark ? "#f1f5f9" : "#111827";
  const textSecondary = isDark ? "#94a3b8" : "#6b7280";

  const safeName = name.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );
  const safeIp = ip.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );

  const tagsHtml = tags
    .slice(0, 2)
    .map(
      (tag) =>
        `<span style="background:${statusColor};color:#fff;padding:1px 6px;border-radius:4px;font-size:8px;font-weight:700;margin:0 1px;">${tag.replace(/[<>&"]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"))}</span>`,
    )
    .join("");

  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80" viewBox="0 0 180 80">
  <rect x="1" y="1" width="178" height="78" rx="6" fill="${bg}" stroke="${border}" stroke-width="1.5"/>
  <rect x="1" y="1" width="4" height="78" rx="3" fill="${statusColor}"/>
  <text x="14" y="28" font-family="monospace,sans-serif" font-size="12" font-weight="700" fill="${textPrimary}" xml:space="preserve">${safeName.substring(0, 18)}</text>
  <text x="14" y="46" font-family="monospace,sans-serif" font-size="10" fill="${textSecondary}" xml:space="preserve">${safeIp}</text>
  ${tagsHtml ? `<foreignObject x="12" y="54" width="160" height="20"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;gap:2px;">${tagsHtml}</div></foreignObject>` : ""}
</svg>`)
  );
}

export function NetworkGraphCard({
  embedded = true,
  onOpenInNewTab,
}: NetworkGraphCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { addTab } = useTabsSafe();

  const [elements, setElements] = useState<NetworkElement[]>([]);
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

  const [selectedHostForAddNode, setSelectedHostForAddNode] = useState("");
  const [selectedGroupForAddNode, setSelectedGroupForAddNode] =
    useState("ROOT");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGroupForMove, setSelectedGroupForMove] = useState("ROOT");
  const [selectedHostForEdge, setSelectedHostForEdge] = useState("");
  const [targetHostForEdge, setTargetHostForEdge] = useState("");
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
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hostMapRef.current = hostMap;
  }, [hostMap]);

  useEffect(() => {
    loadData();
    statusIntervalRef.current = setInterval(updateHostStatuses, 30000);
    const onClickOutside = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      )
        setContextMenu((p) => (p.visible ? { ...p, visible: false } : p));
    };
    document.addEventListener("mousedown", onClickOutside, true);
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      document.removeEventListener("mousedown", onClickOutside, true);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const hostsData = await getSSHHosts();
      const hostsArray = Array.isArray(hostsData) ? hostsData : [];
      setHosts(hostsArray);
      const newMap: HostMap = {};
      hostsArray.forEach((h) => (newMap[String(h.id)] = h));
      setHostMap(newMap);

      let nodes: NetworkTopologyNode[] = [];
      let edges: NetworkTopologyEdge[] = [];
      try {
        const topo = await getNetworkTopology();
        if (topo?.nodes && Array.isArray(topo.nodes)) {
          nodes = topo.nodes.map((node) => {
            const h = newMap[node.data.id];
            return {
              data: {
                id: node.data.id,
                label: h?.name || node.data.label || "Unknown",
                ip: h ? `${h.ip}:${h.port}` : node.data.ip || "",
                status: h?.status || "unknown",
                tags: h?.tags || [],
                parent: node.data.parent,
                color: node.data.color,
              },
              position: node.position || { x: 0, y: 0 },
            };
          });
          edges = topo.edges || [];
        }
      } catch {
        /* start with empty topology */
      }

      const nodeIds = new Set(nodes.map((n) => n.data.id));
      const validEdges = edges.filter(
        (e) => nodeIds.has(e.data.source) && nodeIds.has(e.data.target),
      );
      setElements([...nodes, ...validEdges]);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const updateHostStatuses = useCallback(async () => {
    if (!cyRef.current) return;
    try {
      const updated = await getSSHHosts();
      const updatedMap: HostMap = {};
      updated.forEach((h) => (updatedMap[String(h.id)] = h));
      cyRef.current.nodes().forEach((node) => {
        if (node.isParent()) return;
        const h = updatedMap[node.data("id")];
        if (h) {
          node.data("status", h.status);
          node.data("tags", h.tags || []);
        }
      });
      setHostMap(updatedMap);
    } catch {
      /* ignore */
    }
  }, []);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveCurrentLayout(), 1000);
  }, []);

  const saveCurrentLayout = async () => {
    if (!cyRef.current) return;
    try {
      const nodes = cyRef.current.nodes().map((n) => ({
        data: {
          id: n.data("id"),
          label: n.data("label"),
          ip: n.data("ip"),
          status: n.data("status"),
          tags: n.data("tags") || [],
          parent: n.data("parent"),
          color: n.data("color"),
        },
        position: n.position(),
      }));
      const edges = cyRef.current.edges().map((e) => ({
        data: {
          id: e.data("id"),
          source: e.data("source"),
          target: e.data("target"),
        },
      }));
      await saveNetworkTopology({ nodes, edges });
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!cyRef.current || loading || elements.length === 0) return;
    const hasPositions = elements.some(
      (el) =>
        "position" in el &&
        el.position &&
        (el.position.x !== 0 || el.position.y !== 0),
    );
    if (!hasPositions) {
      cyRef.current
        .layout({
          name: "cose",
          animate: false,
          randomize: true,
          componentSpacing: 100,
          nodeOverlap: 20,
        } as any)
        .run();
    } else {
      cyRef.current.fit();
    }
  }, [loading]);

  const applyStyle = useCallback((cy: cytoscape.Core) => {
    cy.style()
      .selector("node")
      .style({
        label: "",
        width: "180px",
        height: "80px",
        shape: "round-rectangle",
        "border-width": "0px",
        "background-opacity": 0,
        "background-image": (ele) =>
          buildNodeSvg(
            ele.data("label") || "",
            ele.data("ip") || "",
            ele.data("tags") || [],
            ele.data("status") || "unknown",
          ),
        "background-fit": "contain",
      })
      .selector("node:parent")
      .style({
        "background-image": "none",
        "background-color": (ele) => ele.data("color") || "#1e3a8a",
        "background-opacity": 0.08,
        "border-color": (ele) => ele.data("color") || "#3b82f6",
        "border-width": "1.5px",
        "border-style": "dashed",
        label: "data(label)",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -6,
        color: "#94a3b8",
        "font-size": "13px",
        "font-weight": "bold",
        shape: "round-rectangle",
        padding: "12px",
      })
      .selector("edge")
      .style({
        width: "1.5px",
        "line-color": "#3a3a3c",
        "curve-style": "bezier",
        "target-arrow-shape": "none",
      })
      .selector("edge:selected")
      .style({ "line-color": "#f59145", width: "2.5px" })
      .selector("node:selected")
      .style({
        "overlay-color": "#f59145",
        "overlay-opacity": 0.06,
        "overlay-padding": "6px",
      })
      .update();
  }, []);

  const handleNodeInit = useCallback(
    (cy: cytoscape.Core) => {
      cyRef.current = cy;
      if (embedded) {
        cy.nodes().forEach((n) => n.ungrabify());
      } else {
        cy.nodes().forEach((n) => n.grabify());
      }
      applyStyle(cy);

      cy.on("tap", "node", (evt) => {
        setContextMenu((p) => (p.visible ? { ...p, visible: false } : p));
        setSelectedEdgeId(null);
        setSelectedNodeId(evt.target.id());
      });
      cy.on("tap", "edge", (evt) => {
        evt.stopPropagation();
        setSelectedEdgeId(evt.target.id());
        setSelectedNodeId(null);
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) {
          setContextMenu((p) => (p.visible ? { ...p, visible: false } : p));
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        }
      });
      cy.on("cxttap", "node", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const node = evt.target;
        const nodeId = node.id();
        const isGroup = node.isParent() || String(nodeId).startsWith("group-");
        if (isGroup && embedded) return;
        setContextMenu({
          visible: true,
          x: evt.originalEvent.clientX,
          y: evt.originalEvent.clientY,
          targetId: nodeId,
          type: isGroup ? "group" : "node",
        });
      });
      cy.on("zoom pan", () =>
        setContextMenu((p) => (p.visible ? { ...p, visible: false } : p)),
      );
      cy.on("free", "node", () => !embedded && debouncedSave());
      cy.on("boxselect", "node", () => {
        const sel = cy.$("node:selected");
        if (sel.length === 1) setSelectedNodeId(sel[0].id());
      });
    },
    [applyStyle, debouncedSave, embedded],
  );

  const hideMenu = () => setContextMenu((p) => ({ ...p, visible: false }));

  const handleContextAction = (action: string) => {
    hideMenu();
    const targetId = contextMenu.targetId;
    if (!cyRef.current) return;
    if (action === "details") {
      const h = hostMap[targetId];
      if (h) {
        setSelectedNodeForDetail(h);
        setShowNodeDetail(true);
      }
    } else if (action === "connect") {
      const h = hostMap[targetId];
      if (h)
        addTab({
          type: "terminal",
          title: h.name || `${h.username}@${h.ip}:${h.port}`,
          hostConfig: h,
        });
    } else if (action === "move") {
      setSelectedNodeId(targetId);
      const node = cyRef.current.$id(targetId);
      setSelectedGroupForMove(node.data("parent") || "ROOT");
      setShowMoveNodeDialog(true);
    } else if (action === "removeFromGroup") {
      cyRef.current.$id(targetId).move({ parent: null });
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
    hideMenu();
    const h = hostMap[contextMenu.targetId];
    if (!h) return;
    addTab({
      type: appType as any,
      title: h.name || `${h.username}@${h.ip}:${h.port}`,
      hostConfig: h,
    });
  };

  const hasTunnelConnections = (h: SSHHostWithStatus | undefined) => {
    if (!h?.tunnelConnections) return false;
    try {
      const arr = Array.isArray(h.tunnelConnections)
        ? h.tunnelConnections
        : JSON.parse(h.tunnelConnections as string);
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  };

  const handleConfirmAddNode = async () => {
    if (!cyRef.current || !selectedHostForAddNode) return;
    try {
      if (cyRef.current.$id(selectedHostForAddNode).length > 0) {
        setError(t("networkGraph.hostAlreadyExists"));
        return;
      }
      const h = hostMap[selectedHostForAddNode];
      const parent =
        selectedGroupForAddNode === "ROOT"
          ? undefined
          : selectedGroupForAddNode;
      cyRef.current.add({
        data: {
          id: selectedHostForAddNode,
          label: h?.name || h?.ip || selectedHostForAddNode,
          ip: h ? `${h.ip}:${h.port}` : "",
          status: h?.status || "unknown",
          tags: h?.tags || [],
          parent,
        },
        position: {
          x: 100 + Math.random() * 200,
          y: 100 + Math.random() * 200,
        },
      });
      applyStyle(cyRef.current);
      await saveCurrentLayout();
      setElements([...(cyRef.current.elements().jsons() as NetworkElement[])]);
      forceUpdate();
      setShowAddNodeDialog(false);
    } catch {
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
    setElements([...(cyRef.current.elements().jsons() as NetworkElement[])]);
    forceUpdate();
    setShowAddGroupDialog(false);
    setNewGroupName("");
  };

  const handleUpdateGroup = async () => {
    if (!cyRef.current || !editingGroupId || !newGroupName) return;
    const g = cyRef.current.$id(editingGroupId);
    g.data("label", newGroupName);
    g.data("color", newGroupColor);
    await saveCurrentLayout();
    setShowEditGroupDialog(false);
    setEditingGroupId(null);
  };

  const handleMoveNodeToGroup = async () => {
    if (!cyRef.current || !selectedNodeId) return;
    cyRef.current.$id(selectedNodeId).move({
      parent: selectedGroupForMove === "ROOT" ? null : selectedGroupForMove,
    });
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

  const handleExport = () => {
    if (!cyRef.current) return;
    const json = JSON.stringify(cyRef.current.json().elements, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    a.download = "network.json";
    a.click();
  };

  const handleOpenInNewTab = () => {
    if (onOpenInNewTab) {
      onOpenInNewTab();
    } else {
      addTab({
        type: "network_graph" as any,
        title: t("dashboard.networkGraph"),
      });
    }
  };

  const availableGroups = useMemo(
    () =>
      elements
        .filter(
          (el) =>
            !el.data.source && !el.data.target && !el.data.ip && el.data.id,
        )
        .map((el) => ({
          id: el.data.id!,
          label: el.data.label || el.data.id!,
        })),
    [elements],
  );

  const availableNodesForConnection = useMemo(
    () =>
      elements
        .filter((el) => !el.data.source && !el.data.target)
        .map((el) => ({
          id: el.data.id!,
          label: el.data.label || el.data.id!,
        })),
    [elements],
  );

  const availableHostsForAdd = useMemo(() => {
    if (!cyRef.current) return hosts;
    const existing = new Set(elements.map((e) => e.data.id));
    return hosts.filter((h) => !existing.has(String(h.id)));
  }, [hosts, elements]);

  const btnCls =
    "h-7 w-7 p-0 rounded-sm border-0 hover:bg-muted/60 transition-colors flex items-center justify-center text-muted-foreground hover:text-foreground";

  const contextMenuEl = contextMenu.visible ? (
    <div
      ref={contextMenuRef}
      className="fixed z-[300] min-w-[170px] shadow-2xl rounded-sm overflow-hidden bg-card border border-border"
      style={{ top: contextMenu.y, left: contextMenu.x }}
    >
      {contextMenu.type === "node" && (
        <>
          {hostMap[contextMenu.targetId]?.enableTerminal && (
            <button
              onClick={() => handleConnectAction("terminal")}
              className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
            >
              <Terminal className="size-3 shrink-0" />
              {t("networkGraph.terminal")}
            </button>
          )}
          {hostMap[contextMenu.targetId]?.enableFileManager && (
            <button
              onClick={() => handleConnectAction("file_manager")}
              className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
            >
              <FolderOpen className="size-3 shrink-0" />
              {t("networkGraph.fileManager")}
            </button>
          )}
          {hostMap[contextMenu.targetId]?.enableTunnel &&
            hasTunnelConnections(hostMap[contextMenu.targetId]) && (
              <button
                onClick={() => handleConnectAction("tunnel")}
                className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
              >
                <ArrowDownUp className="size-3 shrink-0" />
                {t("networkGraph.tunnel")}
              </button>
            )}
          {hostMap[contextMenu.targetId]?.enableDocker && (
            <button
              onClick={() => handleConnectAction("docker")}
              className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
            >
              <Container className="size-3 shrink-0" />
              {t("networkGraph.docker")}
            </button>
          )}
          <button
            onClick={() => handleConnectAction("server_stats")}
            className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
          >
            <Server className="size-3 shrink-0" />
            {t("networkGraph.serverStats")}
          </button>
          {!embedded && (
            <>
              <div className="h-px bg-border mx-2 my-0.5" />
              <button
                onClick={() => handleContextAction("move")}
                className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
              >
                <FolderInput className="size-3 shrink-0" />
                {t("networkGraph.moveToGroup")}
              </button>
              {cyRef.current?.$id(contextMenu.targetId).parent().length ? (
                <button
                  onClick={() => handleContextAction("removeFromGroup")}
                  className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
                >
                  <FolderMinus className="size-3 shrink-0" />
                  {t("networkGraph.removeFromGroup")}
                </button>
              ) : null}
              <div className="h-px bg-border mx-2 my-0.5" />
              <button
                onClick={() => handleContextAction("delete")}
                className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-destructive/10 text-destructive transition-colors"
              >
                <Trash2 className="size-3 shrink-0" />
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
            className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
          >
            <FolderPlus className="size-3 shrink-0" />
            {t("networkGraph.addHostHere")}
          </button>
          <button
            onClick={() => handleContextAction("editGroup")}
            className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted transition-colors"
          >
            <Edit className="size-3 shrink-0" />
            {t("networkGraph.editGroup")}
          </button>
          <div className="h-px bg-border mx-2 my-0.5" />
          <button
            onClick={() => handleContextAction("delete")}
            className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-destructive/10 text-destructive transition-colors"
          >
            <Trash2 className="size-3 shrink-0" />
            {t("networkGraph.delete")}
          </button>
        </>
      )}
    </div>
  ) : null;

  const cytoscapeEl = (
    <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-background">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {contextMenuEl}
      <CytoscapeComponent
        elements={elements}
        style={{ width: "100%", height: "100%" }}
        layout={{ name: "preset" }}
        cy={handleNodeInit}
        wheelSensitivity={1.5}
        minZoom={0.2}
        maxZoom={3}
      />
      {!loading && elements.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <Network className="size-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground/50">
            {t("networkGraph.noNodes")}
          </p>
        </div>
      )}
    </div>
  );

  const dialogs = (
    <>
      <AlertDialog open={!!error} onOpenChange={() => setError(null)}>
        <AlertDialogContent className="bg-card border border-border">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
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

      <Dialog open={showAddNodeDialog} onOpenChange={setShowAddNodeDialog}>
        <DialogContent className="bg-card border border-border">
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
                    className="justify-between border-border"
                  >
                    {selectedHostForAddNode
                      ? (() => {
                          const h = availableHostsForAdd.find(
                            (h) => String(h.id) === selectedHostForAddNode,
                          );
                          return h ? (
                            <span className="flex flex-col items-start">
                              <span>{h.name || h.ip}</span>
                              <span className="text-xs text-muted-foreground">
                                {h.username}@{h.ip}:{h.port}
                              </span>
                            </span>
                          ) : (
                            t("networkGraph.chooseHost")
                          );
                        })()
                      : t("networkGraph.chooseHost")}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0 w-full bg-card border border-border"
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                >
                  <Command>
                    <CommandInput placeholder={t("networkGraph.searchHost")} />
                    <CommandEmpty>{t("networkGraph.noHostFound")}</CommandEmpty>
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
                    className="justify-between border-border"
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
                  className="p-0 w-full bg-card border border-border"
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                >
                  <Command>
                    <CommandInput placeholder={t("networkGraph.searchGroup")} />
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
        onOpenChange={(o) => {
          if (!o) {
            setShowAddGroupDialog(false);
            setShowEditGroupDialog(false);
          }
        }}
      >
        <DialogContent className="bg-card border border-border">
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
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("networkGraph.color")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {AVAILABLE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNewGroupColor(c.value)}
                    className={cn(
                      "h-9 rounded border-2 transition-all",
                      newGroupColor === c.value
                        ? "border-accent-brand ring-1 ring-accent-brand"
                        : "border-border hover:border-muted-foreground",
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
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
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={showEditGroupDialog ? handleUpdateGroup : handleAddGroup}
              disabled={!newGroupName}
            >
              {showEditGroupDialog ? t("common.update") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMoveNodeDialog} onOpenChange={setShowMoveNodeDialog}>
        <DialogContent className="bg-card border border-border">
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
                    className="justify-between border-border"
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
                  className="p-0 w-full bg-card border border-border"
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                >
                  <Command>
                    <CommandInput placeholder={t("networkGraph.searchGroup")} />
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
        <DialogContent className="bg-card border border-border">
          <DialogHeader>
            <DialogTitle>{t("networkGraph.addConnection")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {[
              {
                label: t("networkGraph.source"),
                val: selectedHostForEdge,
                setVal: setSelectedHostForEdge,
                open: sourceComboOpen,
                setOpen: setSourceComboOpen,
                placeholder: t("networkGraph.selectSourcePlaceholder"),
              },
              {
                label: t("networkGraph.target"),
                val: targetHostForEdge,
                setVal: setTargetHostForEdge,
                open: targetComboOpen,
                setOpen: setTargetComboOpen,
                placeholder: t("networkGraph.selectTargetPlaceholder"),
              },
            ].map(({ label, val, setVal, open, setOpen, placeholder }) => (
              <div key={label} className="grid gap-2">
                <Label>{label}</Label>
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="justify-between border-border"
                    >
                      {val
                        ? availableNodesForConnection.find(
                            (el) => el.id === val,
                          )?.label
                        : placeholder}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-full bg-card border border-border"
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
                              setVal(el.id);
                              setOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                val === el.id ? "opacity-100" : "opacity-0",
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
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddEdgeDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddEdge}>{t("networkGraph.connect")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNodeDetail} onOpenChange={setShowNodeDetail}>
        <DialogContent className="bg-card border border-border">
          <DialogHeader>
            <DialogTitle>{t("networkGraph.hostDetails")}</DialogTitle>
          </DialogHeader>
          {selectedNodeForDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="font-semibold text-muted-foreground">
                  {t("networkGraph.name")}
                </span>
                <span>{selectedNodeForDetail.name}</span>
                <span className="font-semibold text-muted-foreground">
                  {t("networkGraph.ip")}
                </span>
                <span>{selectedNodeForDetail.ip}</span>
                <span className="font-semibold text-muted-foreground">
                  {t("networkGraph.status")}
                </span>
                <span className="capitalize">
                  {selectedNodeForDetail.status || t("networkGraph.unknown")}
                </span>
              </div>
              {selectedNodeForDetail.tags &&
                selectedNodeForDetail.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {selectedNodeForDetail.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNodeDetail(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
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
              if (fileInputRef.current) fileInputRef.current.value = "";
            } catch {
              setError(t("networkGraph.invalidFile"));
            }
          };
          reader.readAsText(file);
        }}
      />
    </>
  );

  if (!embedded) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        {/* toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0 flex-wrap">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedHostForAddNode("");
                setSelectedGroupForAddNode("ROOT");
                setShowAddNodeDialog(true);
              }}
              className="h-7 px-2 text-xs gap-1.5"
            >
              <Plus className="size-3" />
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
              className="h-7 px-2 text-xs gap-1.5"
            >
              <FolderPlus className="size-3" />
              {t("networkGraph.addGroup")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddEdgeDialog(true)}
              className="h-7 px-2 text-xs gap-1.5"
            >
              <Link2 className="size-3" />
              {t("networkGraph.addLink")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveSelected}
              disabled={!selectedNodeId && !selectedEdgeId}
              className="h-7 px-2 text-xs gap-1.5 text-destructive hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() =>
                cyRef.current?.zoom((cyRef.current.zoom() ?? 1) * 1.2)
              }
              title={t("networkGraph.zoomIn")}
              className={btnCls}
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              onClick={() =>
                cyRef.current?.zoom((cyRef.current.zoom() ?? 1) / 1.2)
              }
              title={t("networkGraph.zoomOut")}
              className={btnCls}
            >
              <ZoomOut className="size-3.5" />
            </button>
            <button
              onClick={() => cyRef.current?.fit()}
              title={t("networkGraph.resetView")}
              className={btnCls}
            >
              <RotateCw className="size-3.5" />
            </button>
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleExport}
              title={t("networkGraph.exportJSON")}
              className={btnCls}
            >
              <Download className="size-3.5" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t("networkGraph.importJSON")}
              className={btnCls}
            >
              <Upload className="size-3.5" />
            </button>
          </div>
        </div>
        {cytoscapeEl}
        {dialogs}
      </div>
    );
  }

  /* ── embedded card ── */
  const nodeCount = elements.filter((e) => !e.data.source).length;
  return (
    <Card className="flex flex-col overflow-hidden w-full h-full py-0 gap-0 min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Network className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            {t("dashboard.networkGraph")}
          </span>
          {!loading && (
            <span className="text-[10px] text-muted-foreground/60">
              {t("dashboardTab.nodes", { count: nodeCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() =>
              cyRef.current?.zoom((cyRef.current.zoom() ?? 1) * 1.2)
            }
            title={t("networkGraph.zoomIn")}
            className={btnCls}
          >
            <ZoomIn className="size-3" />
          </button>
          <button
            onClick={() =>
              cyRef.current?.zoom((cyRef.current.zoom() ?? 1) / 1.2)
            }
            title={t("networkGraph.zoomOut")}
            className={btnCls}
          >
            <ZoomOut className="size-3" />
          </button>
          <button
            onClick={() => cyRef.current?.fit()}
            title={t("networkGraph.resetView")}
            className={btnCls}
          >
            <RotateCw className="size-3" />
          </button>
          <button
            onClick={handleOpenInNewTab}
            title={t("common.openInNewTab")}
            className={btnCls}
          >
            <ArrowUp className="size-3" />
          </button>
        </div>
      </div>
      {cytoscapeEl}
      {dialogs}
    </Card>
  );
}
