/**
 * Static file server for the web client with reverse proxy to the realms server.
 * Used in Docker to serve the built Vite assets and proxy API/WS requests.
 */

const PORT = parseInt(process.env.PORT || "8080", 10);
const API_URL = process.env.API_URL || "http://realms-server:3000";
const DIST_DIR = new URL("./dist", import.meta.url).pathname;

const PROXY_PREFIXES = ["/ws", "/info", "/health", "/system", "/auth", "/oauth", "/xrpc"];

function shouldProxy(pathname: string): boolean {
  return PROXY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"),
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /ws
    if (url.pathname === "/ws" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // Proxy WebSocket to realms server
      const target = `${API_URL.replace(/^http/, "ws")}${url.pathname}${url.search}`;
      const upstream = new WebSocket(target);
      const success = server.upgrade(req, { data: { upstream } });
      if (!success) {
        upstream.close();
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return undefined;
    }

    // Proxy API requests to realms server
    if (shouldProxy(url.pathname)) {
      const target = `${API_URL}${url.pathname}${url.search}`;
      const proxyRes = await fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      });
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        statusText: proxyRes.statusText,
        headers: proxyRes.headers,
      });
    }

    // Serve static files
    let filePath = `${DIST_DIR}${url.pathname}`;
    let file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback — serve index.html for client-side routing
    file = Bun.file(`${DIST_DIR}/index.html`);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { upstream } = ws.data as { upstream: WebSocket };
      upstream.onmessage = (e) => ws.send(e.data as string);
      upstream.onclose = () => ws.close();
      upstream.onerror = () => ws.close();
    },
    message(ws, msg) {
      const { upstream } = ws.data as { upstream: WebSocket };
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(msg);
      }
    },
    close(ws) {
      const { upstream } = ws.data as { upstream: WebSocket };
      upstream.close();
    },
  },
});

console.log(`Web client serving on http://0.0.0.0:${server.port}`);
console.log(`Proxying API requests to ${API_URL}`);
