#!/usr/bin/env tsx
import http from "node:http";
import querystring from "node:querystring";

import providersHandler from "./api/providers.js";
import queryHandler from "./api/query.js";
import mcpHandler from "./api/mcp.js";

const PORT = Number(process.env.PORT) || 3000;

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function makeRes(res: http.ServerResponse) {
  const r: any = res;
  const originalEnd = res.end.bind(res);
  r.status = (code: number) => { res.statusCode = code; return r; };
  r.json = (obj: unknown) => {
    res.setHeader("Content-Type", "application/json");
    originalEnd(JSON.stringify(obj));
    return r;
  };
  return r;
}

const server = http.createServer(async (req, res) => {
  const [path, qs] = (req.url || "").split("?");
  const body = await parseBody(req);

  const fakeReq: any = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    query: querystring.parse(qs || ""),
    body,
  };

  const fakeRes = makeRes(res);

  if (path === "/") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      name: "Procurement Labs",
      version: "0.1.0",
      status: "ok",
      endpoints: {
        "GET  /api/providers": "list available API providers",
        "POST /api/query": "execute a provider action",
        "POST /api/mcp": "MCP protocol (JSON-RPC)",
      },
      docs: "https://github.com/tobasummandal/procurementlabs",
    }));
  }

  if (path === "/api/providers") return providersHandler(fakeReq, fakeRes);
  if (path === "/api/query") return queryHandler(fakeReq, fakeRes);
  if (path === "/api/mcp") return mcpHandler(fakeReq, fakeRes);

  res.statusCode = 404;
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`dev server running on http://localhost:${PORT}`);
});
