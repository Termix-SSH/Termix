import type { Tool, Endpoint, ToolSet } from '../types';
import { buildSetAuthTool } from './builder';

/**
 * Parse a ToolSet JSON string into a ToolSet object.
 */
export function parseToolSet(json: string): ToolSet {
  return JSON.parse(json) as ToolSet;
}

/**
 * Build LLM Tool definitions + Endpoint map from a ToolSet.
 */
export function buildFromToolSet(ts: ToolSet): { tools: Tool[]; endpoints: Map<string, Endpoint> } {
  const tools: Tool[] = [];
  const endpoints = new Map<string, Endpoint>();

  for (const ep of ts.endpoints) {
    tools.push({
      type: 'function',
      function: {
        name: ep.name,
        description: ep.description,
        parameters: ep.parameters,
      },
    });

    endpoints.set(ep.name, {
      targetName: ts.target,
      targetDisplayName: ts.target,
      baseURL: ts.base_url,
      method: ep.method,
      path: ep.path,
      auth: ts.auth,
      params: ep.params,
      hasBody: ep.has_body,
    });
  }

  tools.push(buildSetAuthTool(ts.target, ts.auth));

  return { tools, endpoints };
}
