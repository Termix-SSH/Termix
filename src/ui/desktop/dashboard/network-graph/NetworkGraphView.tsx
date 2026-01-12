import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import { getSSHHosts, getNetworkTopology, saveNetworkTopology, type NetworkTopologyData, type SSHHostWithStatus } from '@/ui/main-axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, Move3D, ZoomIn, ZoomOut, RotateCw, Loader2, AlertCircle,
  Download, Upload, Link2, FolderPlus, Edit, FolderInput, FolderMinus, Settings2, ExternalLink, Terminal
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTabs } from '@/ui/desktop/navigation/tabs/TabContext';
import { useSidebar } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

// --- Helper for edge routing ---
const getEndpoints = (edge: cytoscape.EdgeSingular): { sourceEndpoint: string; targetEndpoint: string } => {
  const sourcePos = edge.source().position();
  const targetPos = edge.target().position();
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;

  let sourceEndpoint: string;
  let targetEndpoint: string;

  if (Math.abs(dx) > Math.abs(dy)) {
    sourceEndpoint = dx > 0 ? 'right' : 'left';
    targetEndpoint = dx > 0 ? 'left' : 'right';
  } else {
    sourceEndpoint = dy > 0 ? 'bottom' : 'top';
    targetEndpoint = dy > 0 ? 'top' : 'bottom';
  }
  return { sourceEndpoint, targetEndpoint };
};

// --- Types ---
interface HostMap {
  [key: string]: SSHHostWithStatus;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetId: string;
  type: 'node' | 'group' | 'edge' | null;
}

interface NetworkGraphViewProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
  isStandalone?: boolean;
}

const NetworkGraphView: React.FC<NetworkGraphViewProps> = ({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
  isStandalone = false
}) => {
  const { t } = useTranslation();
  const { addTab } = useTabs();

  let sidebarState: "expanded" | "collapsed" = "expanded";
  try {
    const sidebar = useSidebar();
    sidebarState = sidebar.state;
  } catch (error) {
    // Not in SidebarProvider context (e.g., during authentication)
  }
  
  // --- State ---
  const [elements, setElements] = useState<any[]>([]);
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [hostMap, setHostMap] = useState<HostMap>({});
  
  // Refs
  const hostMapRef = useRef<HostMap>({});
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  
  // Dialog State
  const [showAddNodeDialog, setShowAddNodeDialog] = useState(false);
  const [showAddEdgeDialog, setShowAddEdgeDialog] = useState(false);
  const [showAddGroupDialog, setShowAddGroupDialog] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [showNodeDetail, setShowNodeDetail] = useState(false);
  const [showMoveNodeDialog, setShowMoveNodeDialog] = useState(false);

  // Form State
  const [selectedHostForAddNode, setSelectedHostForAddNode] = useState<string>('');
  const [selectedGroupForAddNode, setSelectedGroupForAddNode] = useState<string>('ROOT');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3b82f6'); // Default Blue
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGroupForMove, setSelectedGroupForMove] = useState<string>('ROOT');
  const [selectedHostForEdge, setSelectedHostForEdge] = useState<string>('');
  const [targetHostForEdge, setTargetHostForEdge] = useState<string>('');
  const [selectedNodeForDetail, setSelectedNodeForDetail] = useState<SSHHostWithStatus | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, targetId: '', type: null
  });

  // System Refs
  const cyRef = useRef<cytoscape.Core | null>(null);
  const statusCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync refs
  useEffect(() => { hostMapRef.current = hostMap; }, [hostMap]);

  // --- Pulsing Dot Overlay for Online Nodes Only ---
  useEffect(() => {
    if (!cyRef.current) return;

    const canvas = document.createElement('canvas');
    const container = cyRef.current.container();
    if (!container) return;

    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    let startTime = Date.now();

    const animate = () => {
      if (!cyRef.current || !ctx) return;

      const canvasWidth = cyRef.current.width();
      const canvasHeight = cyRef.current.height();
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const elapsed = Date.now() - startTime;
      const cycle = (elapsed % 2000) / 2000;
      const zoom = cyRef.current.zoom();

      // Scale pulse radius with zoom
      const baseRadius = 4;
      const pulseAmount = 3;
      const pulseRadius = (baseRadius + Math.sin(cycle * Math.PI * 2) * pulseAmount) * zoom;
      const pulseOpacity = 0.6 - Math.sin(cycle * Math.PI * 2) * 0.4;

      // Draw pulsing green dot for ONLINE nodes only
      cyRef.current.nodes('[status="online"]').forEach(node => {
        if (node.isParent()) return;

        // Use renderedPosition which accounts for zoom and pan
        const pos = node.renderedPosition();
        // Node dimensions at current zoom
        const nodeWidth = 180 * zoom;
        const nodeHeight = 90 * zoom;

        // Position dot at top-right corner (same relative position as SVG)
        const dotX = pos.x + (nodeWidth / 2) - (10 * zoom);
        const dotY = pos.y - (nodeHeight / 2) + (10 * zoom);

        // Draw pulsing ring
        ctx.beginPath();
        ctx.arc(dotX, dotY, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(16, 185, 129, ${pulseOpacity})`;
        ctx.fill();

        // Draw solid center dot
        ctx.beginPath();
        ctx.arc(dotX, dotY, baseRadius * zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
      });

      // Draw static red dot for OFFLINE nodes (no pulsing)
      cyRef.current.nodes('[status="offline"]').forEach(node => {
        if (node.isParent()) return;

        const pos = node.renderedPosition();
        const nodeWidth = 180 * zoom;
        const nodeHeight = 90 * zoom;

        const dotX = pos.x + (nodeWidth / 2) - (10 * zoom);
        const dotY = pos.y - (nodeHeight / 2) + (10 * zoom);

        // Draw solid red dot (no animation)
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4 * zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      });

      animationFrame = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (container && canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    };
  }, [elements]);

  // --- Initialization ---

  useEffect(() => {
    loadData();
    const interval = setInterval(updateHostStatuses, 30000);
    statusCheckIntervalRef.current = interval;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);

    return () => {
      if (statusCheckIntervalRef.current) clearInterval(statusCheckIntervalRef.current);
      document.removeEventListener('mousedown', handleClickOutside, true);
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
      hostsArray.forEach(host => { newHostMap[String(host.id)] = host; });
      setHostMap(newHostMap);

      let nodes: any[] = [];
      let edges: any[] = [];

      try {
        const topologyData = await getNetworkTopology();
        if (topologyData && topologyData.nodes && Array.isArray(topologyData.nodes)) {
          nodes = topologyData.nodes.map((node: any) => {
            const host = newHostMap[node.data.id];
            return {
              data: {
                id: node.data.id,
                label: host?.name || node.data.label || 'Unknown',
                ip: host ? `${host.ip}:${host.port}` : (node.data.ip || ''),
                status: host?.status || 'unknown',
                tags: host?.tags || [],
                parent: node.data.parent,
                color: node.data.color
              },
              position: node.position || { x: 0, y: 0 }
            };
          });
          edges = topologyData.edges || [];
        }
      } catch (topologyError) {
        console.warn('Starting with empty topology');
      }

      setElements([...nodes, ...edges]);
    } catch (err) {
      console.error('Failed to load topology:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const updateHostStatuses = useCallback(async () => {
    if (!cyRef.current) return;
    try {
      const updatedHosts = await getSSHHosts();
      const updatedHostMap: HostMap = {};
      updatedHosts.forEach(host => { updatedHostMap[String(host.id)] = host; });

      cyRef.current.nodes().forEach(node => {
        if (node.isParent()) return;
        const hostId = node.data('id');
        const updatedHost = updatedHostMap[hostId];
        if (updatedHost) {
          node.data('status', updatedHost.status);
          node.data('tags', updatedHost.tags || []);
        }
      });
      setHostMap(updatedHostMap);
    } catch (err) {
      console.error('Status update failed:', err);
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
      const nodes = cyRef.current.nodes().map(node => ({
        data: {
          id: node.data('id'),
          label: node.data('label'),
          ip: node.data('ip'),
          status: node.data('status'),
          tags: node.data('tags') || [],
          parent: node.data('parent'),
          color: node.data('color')
        },
        position: node.position()
      }));

      const edges = cyRef.current.edges().map(edge => ({
        data: {
          id: edge.data('id'),
          source: edge.data('source'),
          target: edge.data('target')
        }
      }));

      await saveNetworkTopology({ nodes, edges });
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  // --- Initial Layout ---
  useEffect(() => {
    if (!cyRef.current || loading || elements.length === 0) return;
    const hasPositions = elements.some((el: any) => el.position && (el.position.x !== 0 || el.position.y !== 0));
    
    if (!hasPositions) {
      cyRef.current.layout({ 
        name: 'cose', 
        animate: false,
        randomize: true,
        componentSpacing: 100,
        nodeOverlap: 20
      }).run();
    } else {
      cyRef.current.fit();
    }
  }, [loading]);

  // --- Cytoscape Config ---

  const handleNodeInit = useCallback((cy: cytoscape.Core) => {
    cyRef.current = cy;
    cy.style()

      /* ===========================
      * NODE STYLE (Hosts)
      * ===========================
      */
      .selector('node')
      .style({
        'label': '',
        'width': '180px',
        'height': '90px',
        'shape': 'round-rectangle',
        'border-width': '0px',
        'background-opacity': 0,

        'background-image': function(ele) {
          const host = ele.data();
          const name = host.label || '';
          const ip = host.ip || '';
          const tags = host.tags || [];
          const isOnline = host.status === 'online';
          const isOffline = host.status === 'offline';
          const statusColor =
            isOnline ? '#10b981' :
            isOffline ? '#ef4444' : '#64748b';

          const tagsHtml = tags.map(t => `
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
            ">${t}</span>`).join('');

          // Changed rx from 8 to 6 to match Dashboard's rounded-md (0.375rem = 6px)
          // Status indicator dot drawn on canvas overlay (see useEffect for pulsing animation)
          const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="90" viewBox="0 0 180 90">
              <defs>
                <filter id="shadow-${ele.id()}" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.25"/>
                </filter>
              </defs>
              <rect x="3" y="3" width="174" height="84" rx="6"
                fill="#09090b" stroke="${statusColor}" stroke-width="2" filter="url(#shadow-${ele.id()})"/>
              <foreignObject x="8" y="8" width="164" height="74">
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style="color:#f1f5f9;text-align:center;font-family:sans-serif;
                  height:100%;display:flex;flex-direction:column;justify-content:center;
                  align-items:center;line-height:1.2;">
                  <div style="font-weight:700;font-size:14px;margin-bottom:2px;
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${name}</div>
                  <div style="font-weight:600;font-size:11px;color:#94a3b8;margin-bottom:6px;
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${ip}</div>
                  <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;">
                    ${tagsHtml}
                  </div>
                </div>
              </foreignObject>
            </svg>
          `;
          return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        },

        'background-fit': 'contain'
      })

      /* ===========================
      * PARENT GROUP STYLE
      * ===========================
      */
      .selector('node:parent')
      .style({
        'background-image': 'none',
        'background-color': ele => ele.data('color') || '#1e3a8a',
        'background-opacity': 0.05,
        'border-color': ele => ele.data('color') || '#3b82f6',
        'border-width': '2px',
        'border-style': 'dashed',
        'label': 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -20,
        'color': '#94a3b8',
        'font-size': '16px',
        'font-weight': 'bold',
        'shape': 'round-rectangle',
        'padding': '10px'
      })

  /* ===========================
   * EDGE STYLE (Improved Bezier)
   * ===========================
   */
  .selector('edge')
  .style({
    'width': '2px',
    'line-color': '#373739',

    // Keep curves but make them smoother and cleaner
    'curve-style': 'round-taxi',

    // Ensure edges connect at the border, not the center
    'source-endpoint': 'outside-to-node',
    'target-endpoint': 'outside-to-node',

    // Smoother curvature
    'control-point-step-size': 10,
    'control-point-distances': [40, -40],
    'control-point-weights': [0.2, 0.8],

    // No arrowheads for now
    'target-arrow-shape': 'none'
  })

  /* ===========================
   * INTERACTION STYLES
   * ===========================
   */
  .selector('edge:selected')
  .style({
    'line-color': '#3b82f6',
    'width': '3px'
  })

  .selector('node:selected')
  .style({
    'overlay-color': '#3b82f6',
    'overlay-opacity': 0.05,
    'overlay-padding': '5px'
  });
 // --- EVENTS ---

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
      setSelectedEdgeId(null);
      setSelectedNodeId(node.id());
      // Dialog only opens from right-click context menu, not left-click
    });

    cy.on('tap', 'edge', (evt) => {
      evt.stopPropagation();
      setSelectedEdgeId(evt.target.id());
      setSelectedNodeId(null);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    });

    // Right Click -> Context Menu
    cy.on('cxttap', 'node', (evt) => {
      evt.preventDefault(); 
      evt.stopPropagation();
      const node = evt.target;
      
      const x = evt.originalEvent.clientX;
      const y = evt.originalEvent.clientY;

      setContextMenu({
        visible: true,
        x,
        y,
        targetId: node.id(),
        type: node.isParent() ? 'group' : 'node'
      });
    });

    cy.on('zoom pan', () => {
      setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
    });

    cy.on('free', 'node', () => debouncedSave());

    cy.on('boxselect', 'node', () => {
      const selected = cy.$('node:selected');
      if (selected.length === 1) setSelectedNodeId(selected[0].id());
    });

  }, [debouncedSave]);

  // --- Handlers ---

  const handleContextAction = (action: string) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const targetId = contextMenu.targetId;
    if (!cyRef.current) return;

    if (action === 'details') {
      const host = hostMap[targetId];
      if (host) {
        setSelectedNodeForDetail(host);
        setShowNodeDetail(true);
      }
    } else if (action === 'connect') {
      const host = hostMap[targetId];
      if (host) {
        const title = host.name?.trim()
          ? host.name
          : `${host.username}@${host.ip}:${host.port}`;
        addTab({ type: 'terminal', title, hostConfig: host });
      }

    } else if (action === 'move') {
      setSelectedNodeId(targetId);
      const node = cyRef.current.$id(targetId);
      const parentId = node.data('parent');
      setSelectedGroupForMove(parentId || 'ROOT');
      setShowMoveNodeDialog(true);
    } else if (action === 'removeFromGroup') {
      const node = cyRef.current.$id(targetId);
      node.move({ parent: null });
      debouncedSave();
    } else if (action === 'editGroup') {
      const node = cyRef.current.$id(targetId);
      setEditingGroupId(targetId);
      setNewGroupName(node.data('label'));
      setNewGroupColor(node.data('color') || '#3b82f6');
      setShowEditGroupDialog(true);
    } else if (action === 'addHostToGroup') {
      setSelectedGroupForAddNode(targetId); 
      setSelectedHostForAddNode('');
      setShowAddNodeDialog(true);
    } else if (action === 'delete') {
      cyRef.current.$id(targetId).remove();
      debouncedSave();
    }
  };

  const handleAddNode = () => {
    setSelectedHostForAddNode('');
    setSelectedGroupForAddNode('ROOT'); 
    setShowAddNodeDialog(true);
  };

  const handleConfirmAddNode = async () => {
    if (!cyRef.current || !selectedHostForAddNode) return;
    try {
      if (cyRef.current.$id(selectedHostForAddNode).length > 0) {
        setError('Host is already in the topology');
        return;
      }
      const host = hostMap[selectedHostForAddNode];
      const parent = selectedGroupForAddNode === 'ROOT' ? undefined : selectedGroupForAddNode;
      
      const newNode = {
        data: {
          id: selectedHostForAddNode,
          label: host.name || `${host.ip}`,
          ip: `${host.ip}:${host.port}`,
          status: host.status,
          tags: host.tags || [],
          parent: parent
        },
        position: { x: 100 + Math.random() * 50, y: 100 + Math.random() * 50 }
      };
      cyRef.current.add(newNode);
      await saveCurrentLayout();
      setShowAddNodeDialog(false);
    } catch (err) { setError('Failed to add node'); }
  };

  const handleAddGroup = async () => {
    if (!cyRef.current || !newGroupName) return;
    const groupId = `group-${Date.now()}`;
    cyRef.current.add({
      data: { id: groupId, label: newGroupName, color: newGroupColor }
    });
    await saveCurrentLayout();
    setShowAddGroupDialog(false);
    setNewGroupName('');
  };

  const handleUpdateGroup = async () => {
    if (!cyRef.current || !editingGroupId || !newGroupName) return;
    const group = cyRef.current.$id(editingGroupId);
    group.data('label', newGroupName);
    group.data('color', newGroupColor);
    await saveCurrentLayout();
    setShowEditGroupDialog(false);
    setEditingGroupId(null);
  };

  const handleMoveNodeToGroup = async () => {
    if (!cyRef.current || !selectedNodeId) return;
    const node = cyRef.current.$id(selectedNodeId);
    const parent = selectedGroupForMove === 'ROOT' ? null : selectedGroupForMove;
    node.move({ parent: parent });
    await saveCurrentLayout();
    setShowMoveNodeDialog(false);
  };

  const handleAddEdge = async () => {
    if (!cyRef.current || !selectedHostForEdge || !targetHostForEdge) return;
    if (selectedHostForEdge === targetHostForEdge) return setError('Source and target must be different');
    
    const edgeId = `${selectedHostForEdge}-${targetHostForEdge}`;
    if (cyRef.current.$id(edgeId).length > 0) return setError('Connection exists');

    cyRef.current.add({
      data: { id: edgeId, source: selectedHostForEdge, target: targetHostForEdge }
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

  // --- Helper Memos ---
  
  // Logic to detect groups directly from Elements state
  const availableGroups = useMemo(() => {
    // A group is a node with ID but no IP (since hosts have IPs) and is not an edge
    return elements.filter(el => 
      !el.data.source && !el.data.target && !el.data.ip && el.data.id
    ).map(el => ({ id: el.data.id, label: el.data.label }));
  }, [elements]);

  const availableNodesForConnection = useMemo(() => {
    return elements.filter(el => (!el.data.source && !el.data.target)).map(el => ({
      id: el.data.id,
      label: el.data.label
    }));
  }, [elements]);

  const availableHostsForAdd = useMemo(() => {
    if (!cyRef.current) return hosts;
    const existingIds = new Set(elements.map(e => e.data.id));
    return hosts.filter(h => !existingIds.has(String(h.id)));
  }, [hosts, elements]);

  // --- Render ---

  // Calculate margins for standalone mode (like Admin Settings and User Profile)
  const topMarginPx = isStandalone ? (isTopbarOpen ? 74 : 26) : 0;
  const leftMarginPx = isStandalone ? (sidebarState === "collapsed" ? 26 : 8) : 0;
  const bottomMarginPx = isStandalone ? 8 : 0;
  const wrapperStyle: React.CSSProperties = isStandalone ? {
    marginLeft: leftMarginPx,
    marginRight: rightSidebarOpen
      ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
      : 17,
    marginTop: topMarginPx,
    marginBottom: bottomMarginPx,
    height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
    transition:
      "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
  } : {};

  const content = (
    <div className="w-full flex flex-col" style={{ height: '100%' }}>
      {error && (
        <div className="absolute top-16 right-4 z-50 flex items-center gap-2 p-3 text-red-100 text-sm rounded shadow-lg animate-in slide-in-from-top-2" style={{backgroundColor: 'rgba(127, 29, 29, 0.9)', border: '1px solid rgb(185, 28, 28)'}}>
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 hover:text-white">✕</button>
        </div>
      )}

      {/* --- Toolbar --- */}
      <div className={`shrink-0 ${isStandalone ? 'mb-4' : 'p-2 mb-2 rounded-lg border-2 border-dark-border bg-dark-bg'}`}>
        <div className="flex items-center gap-4">
          <div className="flex items-center rounded-md border p-0.5 bg-dark-bg-button border-dark-border">
            <Button variant="ghost" size="sm" onClick={handleAddNode} title="Add Host" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setNewGroupName(''); setNewGroupColor('#3b82f6'); setShowAddGroupDialog(true); }} title="Add Group" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <FolderPlus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAddEdgeDialog(true)} title="Add Link" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <Link2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemoveSelected} disabled={!selectedNodeId && !selectedEdgeId} title="Delete Selected" className="h-8 w-8 p-0 rounded text-red-400 hover:text-red-300 hover:bg-dark-hover disabled:opacity-30">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center rounded-md border p-0.5 bg-dark-bg-button border-dark-border">
            <Button variant="ghost" size="sm" onClick={() => cyRef.current?.layout({name: 'cose', animate: true}).run()} title="Auto Layout" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <Move3D className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)} title="Zoom In" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)} title="Zoom Out" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cyRef.current?.fit()} title="Reset View" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <RotateCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center rounded-md border p-0.5 bg-dark-bg-button border-dark-border">
            <Button variant="ghost" size="sm" onClick={() => {
                if (!cyRef.current) return;
                const json = JSON.stringify(cyRef.current.json().elements, null, 2);
                const blob = new Blob([json], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'network.json'; a.click();
            }} title="Export JSON" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} title="Import JSON" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <Upload className="w-4 h-4" />
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={(e) => {
                 const file = e.target.files?.[0];
                 if (!file) return;
                 const reader = new FileReader();
                 reader.onload = (evt) => {
                     try {
                         const json = JSON.parse(evt.target?.result as string);
                         saveNetworkTopology({nodes: json.nodes, edges: json.edges}).then(() => loadData());
                     } catch(err) { setError("Invalid File"); }
                 };
                 reader.readAsText(file);
            }} className="hidden" />
          </div>

          <div className="flex items-center rounded-md border p-0.5 bg-dark-bg-button border-dark-border">
            <Button variant="ghost" size="sm" onClick={() => {
              addTab({ type: 'network_graph', title: 'Network Graph' });
            }} title="Open in new tab" className="h-8 w-8 p-0 rounded text-white hover:bg-dark-hover">
              <ExternalLink className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* --- Graph Area --- */}
      <div className="flex-1 overflow-hidden relative rounded-lg border-2 border-dark-border bg-dark-bg-darkest">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        )}

        {/* Context Menu - Fixed Position with High Z-Index */}
        {contextMenu.visible && (
          <div
            ref={contextMenuRef}
            className="fixed z-[100] min-w-[180px] rounded-md shadow-2xl p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100 bg-dark-bg-panel border border-dark-border text-dark-border-light"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {contextMenu.type === 'node' && (
              <>
                <button onClick={() => handleContextAction('connect')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                  <Terminal className="w-3.5 h-3.5 text-green-400" /> Connect to Host
                </button>
                <button onClick={() => handleContextAction('details')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                  <Settings2 className="w-3.5 h-3.5 text-blue-400" /> Host Details
                </button>
                <button onClick={() => handleContextAction('move')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                  <FolderInput className="w-3.5 h-3.5 text-yellow-400" /> Move to Group...
                </button>
                {cyRef.current?.$id(contextMenu.targetId).parent().length ? (
                  <button onClick={() => handleContextAction('removeFromGroup')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                    <FolderMinus className="w-3.5 h-3.5 text-orange-400" /> Remove from Group
                  </button>
                ) : null}
              </>
            )}

            {contextMenu.type === 'group' && (
              <>
                <button onClick={() => handleContextAction('addHostToGroup')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                  <FolderPlus className="w-3.5 h-3.5 text-green-400" /> Add Host Here
                </button>
                <button onClick={() => handleContextAction('editGroup')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-left w-full transition-colors text-white hover:bg-dark-hover">
                  <Edit className="w-3.5 h-3.5 text-blue-400" /> Edit Group
                </button>
              </>
            )}

            <div className="h-px my-1 bg-dark-border-medium" />
            <button onClick={() => handleContextAction('delete')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-red-400 hover:text-red-300 text-left w-full transition-colors hover:bg-red-950/30">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}

        <CytoscapeComponent
          elements={elements}
          style={{ width: '100%', height: '100%' }}
          layout={{ name: 'preset' }} 
          cy={handleNodeInit}
          wheelSensitivity={0.1}
          minZoom={0.2}
          maxZoom={3}
        />
      </div>

      {/* --- Dialogs --- */}
      
      <Dialog open={showAddNodeDialog} onOpenChange={setShowAddNodeDialog}>
        <DialogContent className="text-slate-200 bg-dark-bg-panel border-dark-border">
          <DialogHeader><DialogTitle>Add Host</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Select Host</Label>
              <Select value={selectedHostForAddNode} onValueChange={setSelectedHostForAddNode}>
                <SelectTrigger className="bg-dark-bg-input border-dark-border"><SelectValue placeholder="Choose a host..." /></SelectTrigger>
                <SelectContent className="bg-dark-bg-panel border-dark-border text-slate-200">
                  {availableHostsForAdd.length > 0 ? availableHostsForAdd.map(h => (
                    <SelectItem key={h.id} value={String(h.id)}>{h.name || h.ip}</SelectItem>
                  )) : <SelectItem value="NONE" disabled>No available hosts</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Parent Group</Label>
              <Select value={selectedGroupForAddNode} onValueChange={setSelectedGroupForAddNode}>
                <SelectTrigger className="bg-dark-bg-input border-dark-border"><SelectValue placeholder="No Group (Root)" /></SelectTrigger>
                <SelectContent className="bg-dark-bg-panel border-dark-border text-slate-200">
                  <SelectItem value="ROOT">No Group</SelectItem>
                  {availableGroups.map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddNodeDialog(false)} className="border-dark-border hover:bg-dark-hover hover:text-slate-200">Cancel</Button>
            <Button onClick={handleConfirmAddNode} disabled={!selectedHostForAddNode} className="bg-blue-600 hover:bg-blue-700 text-white">Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddGroupDialog || showEditGroupDialog} onOpenChange={(open) => {
        if(!open) { setShowAddGroupDialog(false); setShowEditGroupDialog(false); }
      }}>
        <DialogContent className="text-slate-200 bg-dark-bg-panel border-dark-border">
          <DialogHeader>
            <DialogTitle>{showEditGroupDialog ? 'Edit Group' : 'Create Group'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Group Name</Label>
              <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g. Cluster A" className="bg-dark-bg-input border-dark-border" />
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2 items-center p-2 rounded border bg-dark-bg-input border-dark-border">
                <input
                  type="color"
                  value={newGroupColor}
                  onChange={(e) => setNewGroupColor(e.target.value)}
                  className="w-8 h-8 p-0 border-0 rounded cursor-pointer bg-transparent"
                />
                <span className="text-sm text-muted-foreground uppercase">{newGroupColor}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddGroupDialog(false); setShowEditGroupDialog(false); }} className="border-dark-border bg-dark-bg-button hover:bg-dark-hover">Cancel</Button>
            <Button onClick={showEditGroupDialog ? handleUpdateGroup : handleAddGroup} disabled={!newGroupName} className="bg-blue-600 hover:bg-blue-700 text-white">
              {showEditGroupDialog ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMoveNodeDialog} onOpenChange={setShowMoveNodeDialog}>
        <DialogContent className="text-slate-200 bg-dark-bg-panel border-dark-border">
          <DialogHeader><DialogTitle>Move to Group</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Select Group</Label>
              <Select value={selectedGroupForMove} onValueChange={setSelectedGroupForMove}>
                <SelectTrigger className="bg-dark-bg-input border-dark-border"><SelectValue placeholder="Select group..." /></SelectTrigger>
                <SelectContent className="bg-dark-bg-panel border-dark-border text-slate-200">
                  <SelectItem value="ROOT">(No Group)</SelectItem>
                  {availableGroups.map(g => (
                    <SelectItem key={g.id} value={g.id} disabled={g.id === selectedNodeId}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveNodeDialog(false)} className="border-dark-border bg-dark-bg-button hover:bg-dark-hover">Cancel</Button>
            <Button onClick={handleMoveNodeToGroup} className="bg-blue-600 hover:bg-blue-700 text-white">Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddEdgeDialog} onOpenChange={setShowAddEdgeDialog}>
        <DialogContent className="text-slate-200 bg-dark-bg-panel border-dark-border">
          <DialogHeader><DialogTitle>Add Connection</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Source</Label>
              <Select value={selectedHostForEdge} onValueChange={setSelectedHostForEdge}>
                <SelectTrigger className="bg-dark-bg-input border-dark-border"><SelectValue placeholder="Select Source..." /></SelectTrigger>
                <SelectContent className="bg-dark-bg-panel border-dark-border text-slate-200">
                  {availableNodesForConnection.map(el => (
                    <SelectItem key={el.id} value={el.id}>{el.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Target</Label>
              <Select value={targetHostForEdge} onValueChange={setTargetHostForEdge}>
                <SelectTrigger className="bg-dark-bg-input border-dark-border"><SelectValue placeholder="Select Target..." /></SelectTrigger>
                <SelectContent className="bg-dark-bg-panel border-dark-border text-slate-200">
                  {availableNodesForConnection.map(el => (
                    <SelectItem key={el.id} value={el.id}>{el.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEdgeDialog(false)} className="border-dark-border bg-dark-bg-button hover:bg-dark-hover">Cancel</Button>
            <Button onClick={handleAddEdge} className="bg-blue-600 hover:bg-blue-700 text-white">Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNodeDetail} onOpenChange={setShowNodeDetail}>
        <DialogContent className="text-slate-200 bg-dark-bg-panel border-dark-border">
          <DialogHeader><DialogTitle>Host Details</DialogTitle></DialogHeader>
          {selectedNodeForDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="font-semibold text-dark-border-light">Name:</span> <span>{selectedNodeForDetail.name}</span>
                <span className="font-semibold text-dark-border-light">IP:</span> <span>{selectedNodeForDetail.ip}</span>
                <span className="font-semibold text-dark-border-light">Status:</span>
                <span className={selectedNodeForDetail.status === 'online' ? 'text-green-500' : 'text-red-500'}>
                  {selectedNodeForDetail.status}
                </span>
                <span className="font-semibold text-dark-border-light">ID:</span> <span className="text-xs text-dark-border-medium">{selectedNodeForDetail.id}</span>
              </div>
              {selectedNodeForDetail.tags && selectedNodeForDetail.tags.length > 0 && (
                 <div className="flex gap-1 flex-wrap">
                   {selectedNodeForDetail.tags.map(t => (
                     <Badge key={t} variant="outline" className="text-xs border-dark-border-medium text-dark-border-light">{t}</Badge>
                   ))}
                 </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNodeDetail(false)} className="border-dark-border bg-dark-bg-button hover:bg-dark-hover">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Wrap in standalone container if needed
  if (isStandalone) {
    return (
      <div
        style={wrapperStyle}
        className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden"
      >
        <div className="h-full w-full flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2 pb-2">
            <h1 className="font-bold text-lg">Network Graph</h1>
          </div>
          <Separator className="p-0.25 w-full" />
          <div className="px-6 py-4 overflow-auto flex-1">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return content;
};

export { NetworkGraphView };
export default NetworkGraphView;
