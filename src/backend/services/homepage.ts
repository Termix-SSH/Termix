import express from "express";
import cookieParser from "cookie-parser";
import { createCorsMiddleware } from "../utils/cors-config.js";
import { createCompressionMiddleware } from "../utils/compression-config.js";
import { AuthManager } from "../utils/auth-manager.js";
import { listenOnServicePort } from "../utils/service-listen.js";
import { homepageLogger } from "../utils/logger.js";
import { homepageItemsRouter } from "../database/routes/homepage-items-routes.js";
import { homepageLayoutRouter } from "../database/routes/homepage-layout-routes.js";
import { homepageFaviconRouter } from "../database/routes/homepage-favicon-routes.js";
import { homepageRssRouter } from "../database/routes/homepage-rss-routes.js";
import { homepagePingRouter } from "../database/routes/homepage-ping-routes.js";
import { homepageProxyRouter } from "../database/routes/homepage-proxy-routes.js";

const app = express();
app.set("trust proxy", "loopback");
const authManager = AuthManager.getInstance();
const PORT = 30012;

app.use(createCompressionMiddleware());
app.use(createCorsMiddleware());
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(authManager.createAuthMiddleware());

app.use("/homepage/items", homepageItemsRouter);
app.use("/homepage/layout", homepageLayoutRouter);
app.use("/homepage/favicon", homepageFaviconRouter);
app.use("/homepage/rss", homepageRssRouter);
app.use("/homepage/ping", homepagePingRouter);
app.use("/homepage/proxy", homepageProxyRouter);

listenOnServicePort({
  app,
  port: PORT,
  logger: homepageLogger,
  serviceName: "homepage",
});

export default app;
