import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';

// Schemas defined at module level to prevent TS2589 (excessively deep type instantiation)
// caused by complex Zod+MCP generic inference chains.
const listPodsSchema = {
  namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
  labelSelector: z.string().optional().describe('Label selector to filter pods (e.g. app=my-app)'),
  fieldSelector: z.string().optional().describe('Field selector (e.g. status.phase=Failed)'),
};

const getPodSchema = {
  namespace: z.string().describe('Pod namespace'),
  name: z.string().describe('Pod name'),
};

const getPodLogsSchema = {
  namespace: z.string().describe('Pod namespace'),
  name: z.string().describe('Pod name'),
  container: z.string().optional().describe(
    'Container name. Required if the pod has more than one container.'
  ),
  tailLines: z.number().int().min(1).max(5000).optional().describe(
    'Number of log lines to return from the end. Default: 100. Max: 5000.'
  ),
  previous: z.boolean().optional().describe(
    'If true, return logs from the previous (terminated) container instance. ' +
    'Useful for diagnosing crash-loop failures.'
  ),
  sinceSeconds: z.number().int().min(1).optional().describe(
    'Return logs from the last N seconds only.'
  ),
};

export function registerPodTools(server: McpServer): void {
  // ─── list-pods ────────────────────────────────────────────────────────────
  server.tool(
    'list-pods',
    'List pods across all namespaces or in a specific namespace. ' +
    'Shows phase, container statuses, restart counts, and node assignment. ' +
    'Use this to identify failing, pending, or crash-looping pods.',
    listPodsSchema,
    async ({ namespace, labelSelector, fieldSelector }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedPod(namespace, undefined, undefined, undefined, fieldSelector, labelSelector)
          : await coreApi.listPodForAllNamespaces(undefined, undefined, fieldSelector, labelSelector);

        const pods = result.body.items.map(p => ({
          name: p.metadata?.name,
          namespace: p.metadata?.namespace,
          phase: p.status?.phase,
          nodeName: p.spec?.nodeName,
          createdAt: p.metadata?.creationTimestamp,
          conditions: p.status?.conditions?.map(c => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })),
          containers: p.status?.containerStatuses?.map(cs => ({
            name: cs.name,
            ready: cs.ready,
            restartCount: cs.restartCount,
            state: cs.state,
            lastState: cs.lastState,
          })),
          initContainers: p.status?.initContainerStatuses?.map(cs => ({
            name: cs.name,
            ready: cs.ready,
            restartCount: cs.restartCount,
            state: cs.state,
          })),
        }));

        return { content: [{ type: 'text', text: JSON.stringify(pods, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing pods: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-pod ──────────────────────────────────────────────────────────────
  server.tool(
    'get-pod',
    'Get detailed information about a specific pod including spec, status, conditions, ' +
    'container states, resource requests/limits, and volumes. Use for deep-dive diagnosis.',
    getPodSchema,
    async ({ namespace, name }) => {
      try {
        const result = await coreApi.readNamespacedPod(name, namespace);
        const pod = result.body;
        // Remove verbose managedFields to keep output concise
        if (pod.metadata) delete (pod.metadata as Record<string, unknown>).managedFields;
        return { content: [{ type: 'text', text: JSON.stringify(pod, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting pod ${namespace}/${name}: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-pod-logs ─────────────────────────────────────────────────────────
  server.tool(
    'get-pod-logs',
    'Retrieve container logs from a pod. Supports tailing N lines and fetching logs from ' +
    'the previously terminated container (useful after OOMKilled or crash restarts). ' +
    'Essential for application-level troubleshooting.',
    getPodLogsSchema,
    async ({ namespace, name, container, tailLines = 100, previous = false, sinceSeconds }) => {
      try {
        const result = await coreApi.readNamespacedPodLog(
          name,
          namespace,
          container,
          false,                        // follow
          undefined,                    // insecureSkipTLSVerifyBackend
          undefined,                    // limitBytes
          undefined,                    // pretty
          previous,
          sinceSeconds as number | undefined,
          (tailLines ?? 100) as number, // explicit cast resolves TS2345 from deep inference
          false,                        // timestamps
        );
        const logs = result.body || '(no log output)';
        return { content: [{ type: 'text', text: logs }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting pod logs for ${namespace}/${name}: ${msg}` }], isError: true };
      }
    }
  );
}
