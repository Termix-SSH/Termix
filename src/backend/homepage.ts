import express from "express";
import cookieParser from "cookie-parser";
import { createCorsMiddleware } from "./utils/cors-config.js";
import { AuthManager } from "./utils/auth-manager.js";
import { homepageItemsRouter } from "./database/routes/homepage-items-routes.js";
import { homepageLayoutRouter } from "./database/routes/homepage-layout-routes.js";
import { homepageFaviconRouter } from "./database/routes/homepage-favicon-routes.js";
import { homepageRssRouter } from "./database/routes/homepage-rss-routes.js";
import { homepagePingRouter } from "./database/routes/homepage-ping-routes.js";
import { homepageProxyRouter } from "./database/routes/homepage-proxy-routes.js";

const app = express();
const authManager = AuthManager.getInstance();
const PORT = 30012;

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

app.listen(PORT, "127.0.0.1", () => {});

export default app;
