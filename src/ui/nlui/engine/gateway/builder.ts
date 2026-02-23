import type { Tool, Endpoint, ParamInfo, AuthConfig } from '../types';

const RE_INVALID = /[^a-zA-Z0-9_.\-:]/g;

function sanitizeToolName(name: string): string {
  name = name.replace(RE_INVALID, '_');
  if (!name) return '_';
  if (!/^[a-zA-Z_]/.test(name)) name = '_' + name;
  if (name.length > 64) name = name.slice(0, 64);
  return name;
}

function generateOpID(method: string, path: string): string {
  const cleaned = path.replace(/[{}]/g, '').replace(/\//g, '_').replace(/^_|_$/g, '');
  return method.toLowerCase() + '_' + cleaned;
}

/**
 * Resolve a $ref pointer like "#/components/schemas/Pet" against the root doc.
 */
function resolveRef(doc: Record<string, unknown>, ref: string): Record<string, unknown> | null {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return (typeof cur === 'object' && cur !== null) ? cur as Record<string, unknown> : null;
}

/**
 * Convert an OpenAPI schema node into a plain JSON Schema object for LLM tool parameters.
 * Handles $ref resolution.
 */
function schemaToMap(doc: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema) return { type: 'string' };

  // Resolve $ref
  if (typeof schema['$ref'] === 'string') {
    const resolved = resolveRef(doc, schema['$ref']);
    if (resolved) return schemaToMap(doc, resolved);
    return { type: 'string' };
  }

  const m: Record<string, unknown> = {};

  if (schema.type) m.type = schema.type;
  if (schema.description) m.description = schema.description;
  if (Array.isArray(schema.enum) && schema.enum.length) m.enum = schema.enum;

  if (schema.properties && typeof schema.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [name, ref] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (ref && typeof ref === 'object') props[name] = schemaToMap(doc, ref as Record<string, unknown>);
    }
    m.properties = props;
  }

  if (Array.isArray(schema.required) && schema.required.length) m.required = schema.required;
  if (schema.items && typeof schema.items === 'object') {
    m.items = schemaToMap(doc, schema.items as Record<string, unknown>);
  }

  // Gemini requires `items` for array types
  if (m.type === 'array' && !m.items) {
    m.items = { type: 'string' };
  }

  return m;
}

interface BuildResult {
  tools: Tool[];
  endpoints: Map<string, Endpoint>;
}

/**
 * Build LLM Tool definitions + Endpoint map from an OpenAPI spec object.
 */
export function buildTools(
  doc: Record<string, unknown>,
  targetName: string,
  baseURL: string,
  auth: AuthConfig,
): BuildResult {
  const tools: Tool[] = [];
  const endpoints = new Map<string, Endpoint>();

  const paths = doc.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return { tools, endpoints };

  // Build tag → x-server URL map from spec tags (for multi-service routing)
  const tagServerMap = buildTagServerMap(doc, baseURL);

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
    for (const method of methods) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const opID = (op.operationId as string) || generateOpID(method, path);

      let sanitizedTarget = sanitizeToolName(targetName);
      if (sanitizedTarget.replace(/_/g, '') === '') sanitizedTarget = 'target';

      const toolName = sanitizeToolName(sanitizedTarget + '__' + opID);

      const description =
        (op.summary as string) ||
        (op.description as string) ||
        `${method.toUpperCase()} ${path}`;

      const { schema, paramInfos } = buildParams(doc, op);

      // Resolve baseURL: per-operation server > tag x-server > fallback baseURL
      const opTags = op.tags as string[] | undefined;
      const resolvedBase = resolveBaseURL(opTags, tagServerMap, baseURL);

      tools.push({
        type: 'function',
        function: { name: toolName, description, parameters: schema },
      });

      endpoints.set(toolName, {
        targetName: sanitizedTarget,
        targetDisplayName: targetName,
        baseURL: resolvedBase,
        method: method.toUpperCase(),
        path,
        auth,
        params: paramInfos,
        hasBody: op.requestBody != null,
      });
    }
  }

  tools.push(buildSetAuthTool(targetName, auth));

  return { tools, endpoints };
}

/**
 * Build a tag name → server URL map from the spec's tags array.
 * Reads the `x-server` extension on each tag definition.
 * Falls back to replacing the port in baseURL to keep hostname/protocol consistent.
 */
function buildTagServerMap(doc: Record<string, unknown>, baseURL: string): Map<string, string> {
  const map = new Map<string, string>();
  const tags = doc.tags as Array<Record<string, unknown>> | undefined;
  if (!tags) return map;

  for (const tag of tags) {
    const name = tag.name as string | undefined;
    const xServer = tag['x-server'] as string | undefined;
    if (!name || !xServer) continue;

    // Replace the host:port of the x-server URL with the actual baseURL's host
    // so it works in non-localhost environments (e.g., remote servers)
    try {
      const specUrl = new URL(xServer);
      const actualBase = new URL(baseURL);
      specUrl.protocol = actualBase.protocol;
      specUrl.hostname = actualBase.hostname;
      map.set(name, specUrl.toString().replace(/\/+$/, ''));
    } catch {
      map.set(name, xServer.replace(/\/+$/, ''));
    }
  }
  return map;
}

function resolveBaseURL(
  opTags: string[] | undefined,
  tagServerMap: Map<string, string>,
  fallback: string,
): string {
  if (!opTags?.length) return fallback;
  for (const tag of opTags) {
    const url = tagServerMap.get(tag);
    if (url) return url;
  }
  return fallback;
}

export function buildSetAuthTool(targetName: string, auth: AuthConfig): Tool {
  let sanitized = sanitizeToolName(targetName);
  if (sanitized.replace(/_/g, '') === '') sanitized = 'target';

  let desc = `Set authentication credentials for ${targetName}. Call this before making authenticated API requests.`;
  if (auth.type) {
    switch (auth.type) {
      case 'bearer':
        desc += ' This API uses Bearer token authentication \u2014 just provide the token.';
        break;
      case 'header':
        desc += ` This API uses custom header authentication (header: ${auth.headerName ?? ''}) \u2014 just provide the token, auth_type and header_name are already configured.`;
        break;
      case 'query':
        desc += ` This API uses query parameter authentication (param: ${auth.headerName ?? ''}) \u2014 just provide the token, auth_type and header_name are already configured.`;
        break;
    }
  }

  return {
    type: 'function',
    function: {
      name: sanitized + '__set_auth',
      description: desc,
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'The authentication token or API key' },
          auth_type: {
            type: 'string',
            enum: ['bearer', 'header', 'query'],
            description: 'Authentication type. Usually already configured \u2014 only set this to override.',
          },
          header_name: {
            type: 'string',
            description: 'Header or query parameter name. Usually already configured \u2014 only set this to override.',
          },
        },
        required: ['token'],
      },
    },
  };
}

function buildParams(
  doc: Record<string, unknown>,
  op: Record<string, unknown>,
): { schema: Record<string, unknown>; paramInfos: ParamInfo[] } {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const paramInfos: ParamInfo[] = [];

  const params = op.parameters as Array<Record<string, unknown>> | undefined;
  if (params) {
    for (const paramOrRef of params) {
      // Resolve parameter $ref
      const p = (typeof paramOrRef['$ref'] === 'string')
        ? resolveRef(doc, paramOrRef['$ref'] as string) ?? paramOrRef
        : paramOrRef;
      if (!p || !p.name) continue;

      let prop: Record<string, unknown> = { type: 'string' };
      const schema = p.schema as Record<string, unknown> | undefined;
      if (schema) prop = schemaToMap(doc, schema);
      if (p.description) prop.description = `${p.description} (${p.in})`;

      properties[p.name as string] = prop;
      if (p.required) required.push(p.name as string);
      paramInfos.push({
        name: p.name as string,
        in: p.in as 'path' | 'query' | 'header',
        required: !!p.required,
      });
    }
  }

  // Request body
  const requestBody = op.requestBody as Record<string, unknown> | undefined;
  if (requestBody) {
    // Resolve requestBody $ref
    const rb = (typeof requestBody['$ref'] === 'string')
      ? resolveRef(doc, requestBody['$ref'] as string) ?? requestBody
      : requestBody;
    const content = rb.content as Record<string, Record<string, unknown>> | undefined;
    if (content) {
      for (const mediaType of Object.values(content)) {
        const schema = mediaType.schema as Record<string, unknown> | undefined;
        if (schema) {
          properties.body = schemaToMap(doc, schema);
          if (rb.required) required.push('body');
        }
        break; // take first
      }
    }
  }

  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length) schema.required = required;

  return { schema, paramInfos };
}
