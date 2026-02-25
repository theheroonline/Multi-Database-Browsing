import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "http";
import { createProxyMiddleware, type RequestHandler } from "http-proxy-middleware";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function normalizeProxyTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return null;
  }
}

function esProxyPlugin(): Plugin {
  return {
    name: "es-proxy",
    configureServer(server) {
      const proxy = createProxyMiddleware({
        changeOrigin: true,
        secure: false,
        router: (req: IncomingMessage) => {
          const targetHeader = req.headers["x-es-target"];
          if (typeof targetHeader === "string") {
            return normalizeProxyTarget(targetHeader) ?? "http://localhost:9200";
          }
          if (Array.isArray(targetHeader) && targetHeader[0]) {
            return normalizeProxyTarget(targetHeader[0]) ?? "http://localhost:9200";
          }
          return "http://localhost:9200";
        },
        pathRewrite: {
          "^/es": ""
        },
        on: {
          proxyReq: (proxyReq, req) => {
            // 确保 Authorization 头被转发
            const auth = req.headers["authorization"];
            if (auth) {
              proxyReq.setHeader("Authorization", auth);
            }
          },
          error: (err, _req, res) => {
            if (res && "writeHead" in res) {
              (res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
              (res as ServerResponse).end(JSON.stringify({ error: err.message }));
            }
          }
        }
      }) as RequestHandler;

      server.middlewares.use("/es", (req, res, next) => {
        proxy(req, res, next);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), esProxyPlugin()],
  // Tauri 要求使用相对路径
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    open: true,
    cors: true
  }
});
