/**
 * Builds an OpenAPI spec from the @openapi JSDoc blocks above routes. Core and
 * every plugin use this, so the docs site renders them all the same way.
 */

import swaggerJSDoc from "@deadendjs/swagger-jsdoc";

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface BuildOpenApiOptions {
  title: string;
  version: string;
  description?: string;
  /** Source files or globs holding @openapi blocks. */
  files: string[];
  tags?: OpenApiTag[];
}

export type OpenApiSpec = Record<string, unknown> & {
  paths?: Record<string, unknown>;
};

/** How every Termix route is signed in to. */
export const TERMIX_SECURITY_SCHEMES = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Session token sent in the Authorization header as Bearer and the token.",
  },
  cookieAuth: {
    type: "apiKey",
    in: "cookie",
    name: "jwt",
    description:
      "Session JWT cookie set at sign-in. When present, it takes precedence over the Authorization header.",
  },
  apiKeyAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key starting with tmx_",
    description:
      "API key sent in the Authorization header as Bearer and the key, which starts with tmx_. It acts as the key owner and cannot act as anyone else.",
  },
} as const;

export async function buildOpenApi(
  options: BuildOpenApiOptions,
): Promise<OpenApiSpec> {
  const spec = (await swaggerJSDoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: options.title,
        version: options.version,
        ...(options.description ? { description: options.description } : {}),
      },
      servers: [{ url: "/", description: "Your Termix server" }],
      components: {
        securitySchemes: TERMIX_SECURITY_SCHEMES,
        schemas: {
          Error: {
            type: "object",
            properties: {
              error: { type: "string" },
              details: { type: "string" },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }, { cookieAuth: [] }, { apiKeyAuth: [] }],
      ...(options.tags?.length ? { tags: options.tags } : {}),
    },
    apis: options.files.map((f) => f.replace(/\\/g, "/")),
    failOnErrors: true,
  } as Parameters<typeof swaggerJSDoc>[0])) as OpenApiSpec;
  return spec;
}

/** Whether a spec documents any route. */
export function hasOpenApiPaths(spec: OpenApiSpec): boolean {
  return Object.keys(spec.paths ?? {}).length > 0;
}
