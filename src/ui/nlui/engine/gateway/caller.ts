import type { Endpoint } from '../types';
import type { Executor } from '../toolloop/loop';

/**
 * GatewayCaller executes HTTP requests against OpenAPI endpoints.
 * Implements the Executor interface for the ToolLoop.
 */
export class GatewayCaller implements Executor {
  private endpoints: Map<string, Endpoint>;
  onAuthChanged?: (configName: string, token: string) => void;

  constructor(endpoints: Map<string, Endpoint>) {
    this.endpoints = endpoints;
  }

  addEndpoints(endpoints: Map<string, Endpoint>) {
    for (const [k, v] of endpoints) this.endpoints.set(k, v);
  }

  hasTool(name: string): boolean {
    if (this.endpoints.has(name)) return true;
    return name.endsWith('__set_auth');
  }

  async execute(toolName: string, argsJSON: string, authToken: string): Promise<string> {
    // Built-in: set_auth
    if (toolName.endsWith('__set_auth')) {
      const targetPrefix = toolName.replace(/__set_auth$/, '');
      return this.setAuth(targetPrefix, argsJSON);
    }

    const ep = this.endpoints.get(toolName);
    if (!ep) throw new Error(`Unknown tool: ${toolName}`);

    const args: Record<string, unknown> = argsJSON ? JSON.parse(argsJSON) : {};

    // Build URL with path parameters
    let urlPath = ep.path;
    for (const p of ep.params) {
      if (p.in === 'path' && p.name in args) {
        urlPath = urlPath.replace(`{${p.name}}`, encodeURIComponent(String(args[p.name])));
        delete args[p.name];
      }
    }
    // Strip leading '/' so new URL() treats it as relative to the base path, not the origin
    const relPath = urlPath.replace(/^\/+/, '');
    const fullURL = new URL(relPath, ep.baseURL.replace(/\/+$/, '') + '/');

    // Query parameters
    for (const p of ep.params) {
      if (p.in === 'query' && p.name in args) {
        fullURL.searchParams.set(p.name, String(args[p.name]));
        delete args[p.name];
      }
    }

    // Request body
    let body: string | undefined;
    if (ep.hasBody && args.body !== undefined) {
      body = JSON.stringify(args.body);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Auth
    const token = authToken || ep.auth.token || '';
    switch (ep.auth.type) {
      case 'bearer':
        if (token) headers['Authorization'] = `Bearer ${token}`;
        break;
      case 'header':
        if (token && ep.auth.headerName) headers[ep.auth.headerName] = token;
        break;
      case 'query':
        if (token && ep.auth.headerName) {
          fullURL.searchParams.set(ep.auth.headerName, token);
        }
        break;
    }

    // Header parameters
    for (const p of ep.params) {
      if (p.in === 'header' && p.name in args) {
        headers[p.name] = String(args[p.name]);
      }
    }

    const resp = await fetch(fullURL.toString(), {
      method: ep.method,
      headers,
      body: body ?? undefined,
      credentials: 'include',
    });

    const respText = await resp.text();
    if (resp.status >= 400) return `HTTP ${resp.status}: ${respText}`;
    return respText;
  }

  private setAuth(targetName: string, argsJSON: string): string {
    const args: { token?: string; auth_type?: string; header_name?: string } =
      argsJSON ? JSON.parse(argsJSON) : {};

    if (!args.token) return 'Error: token is required';

    let count = 0;
    let actualType = '';
    let actualHeader = '';

    for (const ep of this.endpoints.values()) {
      if (ep.targetName === targetName) {
        ep.auth.token = args.token;
        if (args.auth_type) {
          ep.auth.type = args.auth_type as typeof ep.auth.type;
        } else if (!ep.auth.type) {
          ep.auth.type = 'bearer';
        }
        if (args.header_name) {
          ep.auth.headerName = args.header_name;
        }
        actualType = ep.auth.type;
        actualHeader = ep.auth.headerName ?? '';
        count++;
      }
    }

    if (count === 0) {
      return `No endpoints found for target "${targetName}"`;
    }

    // Persist token via callback
    if (this.onAuthChanged) {
      let configName = targetName;
      for (const ep of this.endpoints.values()) {
        if (ep.targetName === targetName && ep.targetDisplayName) {
          configName = ep.targetDisplayName;
          break;
        }
      }
      this.onAuthChanged(configName, args.token);
    }

    return `Authentication configured: ${count} endpoints updated (type=${actualType}, param=${actualHeader})`;
  }
}
