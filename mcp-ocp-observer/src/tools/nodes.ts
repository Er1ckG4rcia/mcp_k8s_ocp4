import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';

export function registerNodeTools(server: McpServer): void {
  // ─── list-nodes ───────────────────────────────────────────────────────────
  server.tool(
    'list-nodes',
    'List all cluster nodes with their status, conditions, roles, OS image, ' +
    'kernel version, container runtime, capacity, and allocatable resources. ' +
    'Use to identify NotReady nodes, resource pressure, or taints blocking scheduling.',
    {
      labelSelector: z.string().optional().describe(
        'Label selector to filter nodes (e.g. node-role.kubernetes.io/worker=)'
      ),
    },
    async ({ labelSelector }) => {
      try {
        const result = await coreApi.listNode(
          undefined, undefined, undefined, undefined, labelSelector
        );

        const nodes = result.body.items.map(n => ({
          name: n.metadata?.name,
          roles: Object.keys(n.metadata?.labels ?? {})
            .filter(l => l.startsWith('node-role.kubernetes.io/'))
            .map(l => l.replace('node-role.kubernetes.io/', '')),
          status: {
            conditions: n.status?.conditions?.map(c => ({
              type: c.type,
              status: c.status,
              reason: c.reason,
              message: c.message,
              lastTransitionTime: c.lastTransitionTime,
            })),
            capacity: n.status?.capacity,
            allocatable: n.status?.allocatable,
            nodeInfo: {
              osImage: n.status?.nodeInfo?.osImage,
              kernelVersion: n.status?.nodeInfo?.kernelVersion,
              containerRuntimeVersion: n.status?.nodeInfo?.containerRuntimeVersion,
              kubeletVersion: n.status?.nodeInfo?.kubeletVersion,
              architecture: n.status?.nodeInfo?.architecture,
            },
          },
          taints: n.spec?.taints,
          unschedulable: n.spec?.unschedulable ?? false,
          createdAt: n.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(nodes, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing nodes: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-node ─────────────────────────────────────────────────────────────
  server.tool(
    'get-node',
    'Get full details of a specific node including all conditions, resource capacity, ' +
    'allocatable resources, taints, labels, annotations, and runtime info. ' +
    'Use for deep-dive node health analysis.',
    {
      name: z.string().describe('Node name'),
    },
    async ({ name }) => {
      try {
        const result = await coreApi.readNode(name);
        const node = result.body;
        if (node.metadata) delete (node.metadata as Record<string, unknown>).managedFields;
        return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting node ${name}: ${msg}` }], isError: true };
      }
    }
  );
}
