import swaggerJSDoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { systemLogger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, "..", "..", "..");

const swaggerOptions: swaggerJSDoc.Options = {
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
      {
        url: "http://localhost:30003",
        description: "SSH tunnel management server",
      },
      {
        url: "http://localhost:30004",
        description: "SSH file manager server",
      },
      {
        url: "http://localhost:30005",
        description: "Server statistics and monitoring server",
      },
      {
        url: "http://localhost:30006",
        description: "Dashboard server",
      },
      {
        url: "http://localhost:30007",
        description: "Docker management server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
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
    ],
    tags: [
      {
        name: "Alerts",
        description: "System alerts and notifications management",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Credentials",
        description: "SSH credential management",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Network Topology",
        description: "Network topology visualization and management",
        "x-server": "http://localhost:30001",
      },
      {
        name: "RBAC",
        description: "Role-based access control for host sharing",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Snippets",
        description: "Command snippet management",
        "x-server": "http://localhost:30001",
      },
      {
        name: "SSH",
        description: "SSH host management",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Terminal",
        description: "Terminal command history",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Users",
        description: "User management and authentication",
        "x-server": "http://localhost:30001",
      },
      {
        name: "Dashboard",
        description: "Dashboard statistics and activity",
        "x-server": "http://localhost:30006",
      },
      {
        name: "Docker",
        description: "Docker container management",
        "x-server": "http://localhost:30007",
      },
      {
        name: "SSH Tunnels",
        description: "SSH tunnel connection management",
        "x-server": "http://localhost:30003",
      },
      {
        name: "Server Stats",
        description: "Server status monitoring and metrics collection",
        "x-server": "http://localhost:30005",
      },
      {
        name: "Stats",
        description: "Global settings and statistics",
        "x-server": "http://localhost:30005",
      },
      {
        name: "File Manager",
        description: "SSH file management operations",
        "x-server": "http://localhost:30004",
      },
    ],
  },
  apis: [
    path.join(projectRoot, "src", "backend", "database", "routes", "*.ts"),
    path.join(projectRoot, "src", "backend", "dashboard.ts"),
    path.join(projectRoot, "src", "backend", "ssh", "*.ts"),
  ],
};

async function generateOpenAPISpec() {
  try {
    systemLogger.info("Generating OpenAPI specification", {
      operation: "openapi_generate_start",
    });

    const swaggerSpec = swaggerJSDoc(swaggerOptions) as Record<string, unknown>;

    // swagger-jsdoc strips x- extensions from tags — re-inject from our definition
    const defTags = (swaggerOptions.definition as Record<string, unknown>)?.tags as Array<Record<string, unknown>> | undefined;
    if (defTags && Array.isArray(swaggerSpec.tags)) {
      const xServerMap = new Map<string, string>();
      for (const t of defTags) {
        if (t.name && t['x-server']) xServerMap.set(t.name as string, t['x-server'] as string);
      }
      for (const t of swaggerSpec.tags as Array<Record<string, unknown>>) {
        const xs = xServerMap.get(t.name as string);
        if (xs) t['x-server'] = xs;
      }
    }

    const outputPath = path.join(projectRoot, "openapi.json");

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

await generateOpenAPISpec();

export { swaggerOptions, generateOpenAPISpec };
