import type { PluginServices } from "@termix/plugin-sdk/backend";

let current: PluginServices | null = null;

/** Set in activate, cleared on deactivate. */
export function setPluginServices(services: PluginServices | null): void {
  current = services;
}

/** Another plugin's workspaces, as ctx.services.get("workspaces.saved") returns them. */
interface SavedWorkspaces {
  list: () => Promise<Array<{ id: number; name: string; isDefault: boolean }>>;
}

/**
 * The user's saved workspaces, or null when the workspaces plugin is off or
 * the user may not use it. Optional: the assistant works without it.
 */
export async function listSavedWorkspaces(
  userId: string,
): Promise<Array<{ id: number; name: string; isDefault: boolean }> | null> {
  if (!current) return null;
  try {
    return await current
      .get<SavedWorkspaces>("workspaces.saved", { userId })
      .list();
  } catch {
    return null;
  }
}

/** Another plugin's graph, as ctx.services.get("network-topology.graph") returns it. */
interface NetworkTopologyGraph {
  get: () => Promise<unknown | null>;
}

/**
 * The user's saved network topology, or null when the network-topology
 * plugin is off or the user may not use it. Optional: the tool disappears
 * without it.
 */
export async function getNetworkTopology(
  userId: string,
): Promise<unknown | null> {
  if (!current) return null;
  try {
    return await current
      .get<NetworkTopologyGraph>("network-topology.graph", { userId })
      .get();
  } catch {
    return null;
  }
}

/** Another plugin's fleets, as ctx.services.get("fleets.access") returns them. */
interface FleetsAccess {
  list: () => Promise<
    Array<{ id: number; name: string; color: string | null }>
  >;
  create: (input: {
    name: string;
    description?: string | null;
  }) => Promise<{ id: number; name: string }>;
  addMember: (fleetId: number, hostId: number) => Promise<void>;
}

/**
 * The user's fleets, or null when the fleets plugin is off or the user may
 * not use it. Optional: the list_fleets tool disappears without it.
 */
export async function listFleets(
  userId: string,
): Promise<Array<{ id: number; name: string; color: string | null }> | null> {
  if (!current) return null;
  try {
    return await current.get<FleetsAccess>("fleets.access", { userId }).list();
  } catch {
    return null;
  }
}

/**
 * Requires the fleets plugin, unlike listFleets above: a proposal apply must
 * surface a failure as an error the user sees, not silently no-op.
 */
function requireFleetsAccess(userId: string): FleetsAccess {
  if (!current) {
    throw new Error("The fleets plugin is disabled");
  }
  return current.get<FleetsAccess>("fleets.access", { userId });
}

export async function createFleet(
  userId: string,
  input: { name: string; description?: string | null },
): Promise<{ id: number; name: string } | null> {
  if (!current) return null;
  return requireFleetsAccess(userId).create(input);
}

export async function addFleetMember(
  userId: string,
  fleetId: number,
  hostId: number,
): Promise<void> {
  await requireFleetsAccess(userId).addMember(fleetId, hostId);
}

export interface SnippetSummary {
  id: number;
  name: string;
  content: string;
  description: string | null;
  isNote: boolean;
  folder: string | null;
}

/** Another plugin's snippets, as ctx.services.get("snippets.access") returns them. */
interface SnippetsAccess {
  list: () => Promise<SnippetSummary[]>;
  get: (id: number) => Promise<{
    id: number;
    name: string;
    content: string;
    isNote: boolean;
  } | null>;
  create: (input: {
    name: string;
    content: string;
    description?: string | null;
    folder?: string | null;
  }) => Promise<{ id: number; name: string }>;
  update: (
    id: number,
    changes: {
      name?: string;
      content?: string;
      description?: string | null;
      folder?: string | null;
    },
  ) => Promise<void>;
  remove: (id: number) => Promise<boolean>;
}

/**
 * The user's own snippets, or null when the snippets plugin is off or the
 * user may not use it. Optional: the list_snippets tool disappears without
 * it, and the propose_*_snippet tools fail with a clear message.
 */
export async function listSnippets(
  userId: string,
): Promise<SnippetSummary[] | null> {
  if (!current) return null;
  try {
    return await current
      .get<SnippetsAccess>("snippets.access", { userId })
      .list();
  } catch {
    return null;
  }
}

export async function getSnippet(
  userId: string,
  id: number,
): Promise<{
  id: number;
  name: string;
  content: string;
  isNote: boolean;
} | null> {
  if (!current) return null;
  try {
    return await current
      .get<SnippetsAccess>("snippets.access", { userId })
      .get(id);
  } catch {
    return null;
  }
}

/**
 * Requires the snippets plugin, unlike the read helpers above: a failed
 * proposal apply must surface as an error the user sees, not silently no-op.
 */
function requireSnippetsAccess(userId: string): SnippetsAccess {
  if (!current) {
    throw new Error("The snippets plugin is disabled");
  }
  return current.get<SnippetsAccess>("snippets.access", { userId });
}

export async function createSnippet(
  userId: string,
  input: {
    name: string;
    content: string;
    description?: string | null;
    folder?: string | null;
  },
): Promise<{ id: number; name: string }> {
  return requireSnippetsAccess(userId).create(input);
}

export async function updateSnippet(
  userId: string,
  id: number,
  changes: {
    name?: string;
    content?: string;
    description?: string | null;
    folder?: string | null;
  },
): Promise<void> {
  return requireSnippetsAccess(userId).update(id, changes);
}

export async function deleteSnippet(
  userId: string,
  id: number,
): Promise<boolean> {
  return requireSnippetsAccess(userId).remove(id);
}
