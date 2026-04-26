/// <reference types="node" />
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { bearerTokenAuth } from './auth.js';
import { createMcpServer } from './server.js';

// ─── Global crash protection ──────────────────────────────────────────────────
// Prevent unhandled rejections and uncaught exceptions from killing the pod.
// All errors are logged but the process keeps running.
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception (process kept alive):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection (process kept alive):', reason);
});

const app = express();

// Parse JSON bodies for all requests (required by Streamable HTTP transport)
app.use(express.json({ limit: '10mb' }));

// ─── Health endpoint ─────────────────────────────────────────────────────────
// Used by OpenShift liveness and readiness probes — no auth required.
app.get('/health', (_req: import('express').Request, res: import('express').Response) => {
  res.json({ status: 'ok', version: config.serverVersion, name: config.serverName });
});

// ─── MCP Streamable HTTP endpoint ────────────────────────────────────────────
// Handles all MCP protocol messages (initialize, tools/call, tools/list, etc.)
// Each request creates a fresh McpServer + transport (stateless design).
app.all('/mcp', bearerTokenAuth, async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    // undefined = stateless mode: no session is maintained between requests.
    // This is correct for a read-only observability server.
    sessionIdGenerator: undefined,
  });

  // Close the server only after the HTTP response connection closes.
  // Closing in a finally block was terminating the SSE stream before events were flushed.
  res.on('close', () => {
    server.close().catch((err) =>
      console.error('[mcp] Error closing server after response:', err)
    );
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] Request handling error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────────
app.listen(config.port, '0.0.0.0', () => {
  console.log(`[startup] ${config.serverName} v${config.serverVersion}`);
  console.log(`[startup] Listening on 0.0.0.0:${config.port}`);
  console.log(`[startup] MCP endpoint : http://0.0.0.0:${config.port}/mcp`);
  console.log(`[startup] Health check : http://0.0.0.0:${config.port}/health`);

  if (!config.mcpAuthEnabled) {
    console.warn('[startup] ⚠️  WARNING: MCP_AUTH_TOKEN is not set — bearer auth is DISABLED');
    console.warn('[startup] ⚠️  Set MCP_AUTH_TOKEN via a Kubernetes Secret before production use');
  } else {
    console.log('[startup] Bearer token authentication: ENABLED');
  }
});
