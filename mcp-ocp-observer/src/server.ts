import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { registerPodTools } from './tools/pods.js';
import { registerNodeTools } from './tools/nodes.js';
import { registerNodeLogTools } from './tools/node-logs.js';
import { registerEventTools } from './tools/events.js';
import { registerWorkloadTools } from './tools/workloads.js';
import { registerNetworkingTools } from './tools/networking.js';
import { registerNamespaceTools } from './tools/namespaces.js';
import { registerStorageTools } from './tools/storage.js';
import { registerConfigResourceTools } from './tools/config-resources.js';
import { registerRbacTools } from './tools/rbac.js';
import { registerMachineTools } from './tools/machines.js';

/**
 * Factory function that creates and fully configures an McpServer instance.
 * Called once per incoming HTTP request (stateless transport pattern).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // Register all tool groups
  registerPodTools(server);
  registerNodeTools(server);
  registerNodeLogTools(server);
  registerEventTools(server);
  registerWorkloadTools(server);
  registerNetworkingTools(server);
  registerNamespaceTools(server);
  registerStorageTools(server);
  registerConfigResourceTools(server);
  registerRbacTools(server);
  registerMachineTools(server);

  return server;
}
