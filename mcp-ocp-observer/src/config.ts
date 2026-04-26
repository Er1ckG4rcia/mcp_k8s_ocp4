/// <reference types="node" />
// All configuration values are read exclusively from environment variables.
// Never hardcode secrets or hostnames here.

export const config = {
  /** HTTP port the MCP server listens on. Default: 8080 */
  port: parseInt(process.env.PORT ?? '8080', 10),

  /** Human-readable name reported in MCP server metadata */
  serverName: process.env.MCP_SERVER_NAME ?? 'mcp-ocp-observer',

  /** Semver string reported in MCP server metadata */
  serverVersion: process.env.MCP_SERVER_VERSION ?? '1.0.0',

  /** Log verbosity: debug | info | warn | error */
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /**
   * Static bearer token that MCP clients must send as:
   *   Authorization: Bearer <token>
   *
   * If not set, authentication is DISABLED (dev mode only).
   * Always set this via a Kubernetes Secret in production.
   */
  mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? '',
  mcpAuthEnabled: !!process.env.MCP_AUTH_TOKEN,
} as const;
