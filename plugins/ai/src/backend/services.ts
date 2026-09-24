import type { PluginServices } from "@termix/plugin-sdk/backend";

/**
 * Other plugins the assistant reads and changes through, each optional. A
 * service call runs as the acting user and the provider checks that user's
 * permissions, so nothing here takes a user id.
 */

export const SERVICE = {
  snippets: "snippets.access",
  fleets: "fleets.access",
  automations: "automations.access",
  workspaces: "workspaces.saved",
  topology: "network-topology.graph",
  history: "terminal.history",
  homepage: "homepage.items",
} as const;

export type ServiceName = (typeof SERVICE)[keyof typeof SERVICE];

/** Whether a compatible provider is running right now. */
export function serviceAvailable(
  services: Pick<PluginServices, "providers">,
  service: string,
): boolean {
  try {
    return services.providers(service).length > 0;
  } catch {
    return false;
  }
}

export interface SnippetSummary {
  id: number;
  name: string;
  content: string;
  description: string | null;
  isNote: boolean;
  folder: string | null;
}

export interface SnippetsAccess {
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

export interface FleetsAccess {
  list: () => Promise<
    Array<{ id: number; name: string; color: string | null }>
  >;
  create: (input: {
    name: string;
    description?: string | null;
  }) => Promise<{ id: number; name: string }>;
  addMember: (fleetId: number, hostId: number) => Promise<void>;
}

export interface AutomationsAccess {
  list: () => Promise<
    Array<{
      id: number;
      name: string;
      description: string | null;
      enabled: boolean;
      triggerKind: string | null;
      lastRunAt: string | null;
      lastRunStatus: string | null;
      missingPlugins: string[];
    }>
  >;
  get: (id: number) => Promise<{
    id: number;
    name: string;
    enabled: boolean;
    definition: unknown;
  } | null>;
  create: (input: {
    name: string;
    description?: string | null;
    definition: unknown;
    enabled?: boolean;
  }) => Promise<{ id: number; name: string }>;
}

export interface SavedWorkspaces {
  list: () => Promise<Array<{ id: number; name: string; isDefault: boolean }>>;
}

export interface NetworkTopologyGraph {
  get: () => Promise<unknown | null>;
}

export interface TerminalHistory {
  list: (
    hostId: number,
    limit?: number,
  ) => Promise<Array<{ command: string; executedAt: string }>>;
}

/** homepage.items v1, which the homepage plugin provides from B19. */
export interface HomepageItems {
  list: () => Promise<
    Array<{ id: number; typeId: string; title: string | null }>
  >;
}

interface ServiceTypes {
  "snippets.access": SnippetsAccess;
  "fleets.access": FleetsAccess;
  "automations.access": AutomationsAccess;
  "workspaces.saved": SavedWorkspaces;
  "network-topology.graph": NetworkTopologyGraph;
  "terminal.history": TerminalHistory;
  "homepage.items": HomepageItems;
}

/**
 * The service handle. Throws when the provider is missing or the user may
 * not use it; a proposal apply wants that error, a read tool catches it.
 */
export function requireService<S extends ServiceName>(
  services: Pick<PluginServices, "get" | "providers">,
  service: S,
): ServiceTypes[S] {
  if (!serviceAvailable(services, service)) {
    throw new Error(`The ${service.split(".")[0]} plugin is not available`);
  }
  return services.get<ServiceTypes[S]>(service);
}

/** A read through a service, or null when it is missing or refused. */
export async function readService<S extends ServiceName, T>(
  services: Pick<PluginServices, "get" | "providers">,
  service: S,
  read: (handle: ServiceTypes[S]) => Promise<T>,
): Promise<T | null> {
  try {
    return await read(requireService(services, service));
  } catch {
    return null;
  }
}
