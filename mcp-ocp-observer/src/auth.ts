import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

/**
 * Express middleware that enforces static bearer token authentication
 * on the /mcp endpoint.
 *
 * Clients must send:  Authorization: Bearer <MCP_AUTH_TOKEN>
 *
 * If MCP_AUTH_TOKEN is not set (mcpAuthEnabled=false), auth is skipped.
 * This is intentional for local development — NEVER deploy without a token.
 */
export function bearerTokenAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcpAuthEnabled) {
    console.warn(`[auth] WARNING: MCP_AUTH_TOKEN not set — request from ${req.ip} allowed without auth`);
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Bearer ${config.mcpAuthToken}`) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    return;
  }

  next();
}
