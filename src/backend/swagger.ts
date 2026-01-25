import swaggerJSDoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";

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
      },
      {
        name: "Credentials",
        description: "SSH credential management",
      },
      {
        name: "Network Topology",
        description: "Network topology visualization and management",
      },
      {
        name: "RBAC",
        description: "Role-based access control for host sharing",
      },
      {
        name: "Snippets",
        description: "Command snippet management",
      },
      {
        name: "Terminal",
        description: "Terminal command history",
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
        name: "Docker",
        description: "Docker container management",
      },
      {
        name: "SSH Tunnels",
        description: "SSH tunnel connection management",
      },
      {
        name: "Server Stats",
        description: "Server status monitoring and metrics collection",
      },
      {
        name: "File Manager",
        description: "SSH file management operations",
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
    const swaggerSpec = swaggerJSDoc(swaggerOptions);

    const outputPath = path.join(projectRoot, "openapi.json");

    await fs.writeFile(
      outputPath,
      JSON.stringify(swaggerSpec, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Failed to generate OpenAPI specification:", error);
    process.exit(1);
  }
}

generateOpenAPISpec();

export { swaggerOptions, generateOpenAPISpec };
