export const NETWORK = "termix-dev";
export const APP_CONTAINER = "termix-dev";
export const APP_IMAGE = "termix:dev";

/** Side containers npm run dev can run. hostPort is what the local backend uses. */
export const SERVICES = {
  postgres: {
    container: "termix-dev-postgres",
    image: "postgres:16",
    hostPort: 55432,
    port: 5432,
    env: {
      POSTGRES_USER: "termix",
      POSTGRES_PASSWORD: "termix",
      POSTGRES_DB: "termix",
    },
    volume: ["termix-dev-postgres", "/var/lib/postgresql/data"],
    // Over TCP, so the server that only runs during first-time setup does
    // not count as ready.
    ready: ["pg_isready", "-h", "127.0.0.1", "-U", "termix", "-d", "termix"],
  },
  mysql: {
    container: "termix-dev-mysql",
    image: "mysql:8",
    hostPort: 33306,
    port: 3306,
    env: { MYSQL_ROOT_PASSWORD: "termix", MYSQL_DATABASE: "termix" },
    volume: ["termix-dev-mysql", "/var/lib/mysql"],
    ready: ["mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-ptermix"],
  },
  guacd: {
    container: "termix-dev-guacd",
    image: "guacamole/guacd:1.6.0",
    hostPort: 4822,
    port: 4822,
    env: {},
    volume: null,
    ready: null,
  },
};

function envArgs(env) {
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
}

export function serviceRunArgs(service) {
  return [
    "run",
    "-d",
    "--name",
    service.container,
    "--network",
    NETWORK,
    "-p",
    `${service.hostPort}:${service.port}`,
    ...envArgs(service.env),
    ...(service.volume
      ? ["-v", `${service.volume[0]}:${service.volume[1]}`]
      : []),
    service.image,
  ];
}

/**
 * Environment that points a backend at the side containers. inDocker means
 * the backend runs in the dev network and reaches them by name.
 */
export function serviceEnv(options, inDocker) {
  const env = {};
  const address = (service) =>
    inDocker
      ? `${service.container}:${service.port}`
      : `127.0.0.1:${service.hostPort}`;
  if (options.db === "postgres") {
    env.DATABASE_DIALECT = "postgres";
    env.DATABASE_URL = `postgres://termix:termix@${address(SERVICES.postgres)}/termix`;
  } else if (options.db === "mysql") {
    env.DATABASE_DIALECT = "mysql";
    env.DATABASE_URL = `mysql://root:termix@${address(SERVICES.mysql)}/termix`;
  }
  if (options.guacd) {
    const guacd = SERVICES.guacd;
    env.GUACD_HOST = inDocker ? guacd.container : "127.0.0.1";
    env.GUACD_PORT = String(inDocker ? guacd.port : guacd.hostPort);
  }
  return env;
}

export function appRunArgs({ port, env, dataMount, pluginsDir }) {
  return [
    "run",
    "-d",
    "--name",
    APP_CONTAINER,
    "--network",
    NETWORK,
    "-p",
    `${port}:8080`,
    ...envArgs({ PORT: "8080", NODE_ENV: "development", ...env }),
    "-v",
    `${dataMount}:/app/data`,
    "-v",
    `${pluginsDir}:/app/dist/plugins`,
    APP_IMAGE,
  ];
}
