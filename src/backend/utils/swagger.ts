import swaggerJSDoc from "@deadendjs/swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { systemLogger } from "./logger.js";

type SwaggerJSDocOptions = Parameters<typeof swaggerJSDoc>[0];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// dist/backend/backend/utils -> the repository.
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

/**
 * A tag per plugin, named and described by its manifest, so the reference
 * groups a plugin's routes without core naming any plugin.
 */
async function pluginTags(): Promise<{ name: string; description: string }[]> {
  const pluginsDir = path.join(REPO_ROOT, "plugins");
  const tags: { name: string; description: string }[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(pluginsDir);
  } catch {
    return tags;
  }
  for (const entry of entries.sort()) {
    try {
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(pluginsDir, entry, "manifest.json"),
          "utf8",
        ),
      ) as { name?: string; description?: string };
      if (manifest.name) {
        tags.push({
          name: manifest.name,
          description: manifest.description ?? "",
        });
      }
    } catch {
      // Not a plugin folder.
    }
  }
  return tags;
}

const swaggerOptions: SwaggerJSDocOptions = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Termix API",
      version: "0.0.0",
      description: "Termix Backend API Reference",
    },
    servers: [
      {
        url: "http://localhost:30001",
        description: "Main database and authentication server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Session JWT sent as Authorization: Bearer <JWT>.",
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
          bearerFormat: "tmx_<api key>",
          description:
            "API key sent as Authorization: Bearer tmx_<api key>. Permissions follow the key owner's account; encrypted data must be unlocked separately. API keys cannot impersonate another user.",
        },
      },
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
    security: [
      {
        bearerAuth: [],
      },
      {
        cookieAuth: [],
      },
      {
        apiKeyAuth: [],
      },
    ],
    tags: [
      {
        name: "Credentials",
        description: "SSH credential management",
      },
      {
        name: "RBAC",
        description: "Role-based access control for host sharing",
      },
      {
        name: "Users",
        description: "User management and authentication",
      },
      {
        name: "Dashboard",
        description: "Dashboard statistics and activity",
      },
      {
        name: "SSH",
        description: "SSH host management and configuration",
      },
      {
        name: "Host Enrollment",
        description: "Host enrollment and onboarding",
      },
      {
        name: "Open Tabs",
        description: "Per-user open tab state",
      },
      {
        name: "Audit",
        description: "Audit log querying and export",
      },
      {
        name: "API Keys",
        description: "API key management",
      },
      {
        name: "Sync",
        description: "Remote sync between desktop and server",
      },
      {
        name: "User Preferences",
        description: "Per-user application preferences",
      },
      {
        name: "UI Preferences",
        description: "Interface layout and display preferences",
      },
      {
        name: "Host Sidebar",
        description: "Host sidebar display preferences",
      },
      {
        name: "Credential Sidebar",
        description: "Credential sidebar display preferences",
      },
    ],
  },
  apis: [
    path.join(__dirname, "..", "database", "database.js").replace(/\\/g, "/"),
    path
      .join(__dirname, "..", "database", "routes", "*.js")
      .replace(/\\/g, "/"),
    path.join(__dirname, "..", "services", "*.js").replace(/\\/g, "/"),
    path.join(__dirname, "..", "hosts", "*.js").replace(/\\/g, "/"),
    path.join(__dirname, "..", "hosts", "**", "*.js").replace(/\\/g, "/"),
    // Plugin routes document themselves. Read from source, because a plugin's
    // bundle drops comments.
    path
      .join(REPO_ROOT, "plugins", "*", "src", "backend", "**", "*.ts")
      .replace(/\\/g, "/"),
  ],
};

async function generateOpenAPISpec() {
  try {
    systemLogger.info("Generating OpenAPI specification", {
      operation: "openapi_generate_start",
    });

    const definition = swaggerOptions.definition as { tags?: unknown[] };
    definition.tags = [...(definition.tags ?? []), ...(await pluginTags())];
    const swaggerSpec = await swaggerJSDoc(swaggerOptions);

    const outputPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "openapi.json",
    );

    await fs.writeFile(
      outputPath,
      JSON.stringify(swaggerSpec, null, 2),
      "utf-8",
    );

    systemLogger.success("OpenAPI specification generated", {
      operation: "openapi_generate_success",
    });
  } catch (error) {
    systemLogger.error("Failed to generate OpenAPI specification", error, {
      operation: "openapi_generation",
    });
    process.exit(1);
  }
}

generateOpenAPISpec();

export { swaggerOptions, generateOpenAPISpec };
