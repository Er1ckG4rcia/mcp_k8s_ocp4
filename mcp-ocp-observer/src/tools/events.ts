import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';

// Schema defined at module level to prevent TS2589 (excessively deep type instantiation)
// caused by complex Zod+MCP generic inference chains.
const listEventsSchema = {
  namespace: z.string().optional().describe(
    'Namespace to list events from. Omit for cluster-wide (noisy on large clusters).'
  ),
  involvedObjectName: z.string().optional().describe(
    'Filter events involving a specific object name (e.g. a pod or deployment name).'
  ),
  eventType: z.enum(['Warning', 'Normal']).optional().describe(
    'Filter by event type. "Warning" events are most useful for troubleshooting.'
  ),
};

export function registerEventTools(server: McpServer): void {
  // ─── list-events ──────────────────────────────────────────────────────────
  server.tool(
    'list-events',
    'List Kubernetes/OpenShift events. Optionally filter by namespace, involved object name, ' +
    'or event type (Warning/Normal). Events reveal WHY resources are failing — e.g. ' +
    'ImagePullBackOff, OOMKilled, FailedScheduling, BackOff. ' +
    'Omit namespace to list events cluster-wide (requires ClusterRole).',
    listEventsSchema,
    async ({ namespace, involvedObjectName, eventType }) => {
      try {
        // Build field selector from optional filters
        const selectors: string[] = [];
        if (involvedObjectName) selectors.push(`involvedObject.name=${involvedObjectName}`);
        if (eventType) selectors.push(`type=${eventType}`);
        const fieldSelector = selectors.length > 0 ? selectors.join(',') : undefined;

        const result = namespace
          ? await coreApi.listNamespacedEvent(namespace, undefined, undefined, undefined, fieldSelector)
          : await coreApi.listEventForAllNamespaces(undefined, undefined, fieldSelector);

        const events = result.body.items
          // Sort by most recent first
          .sort((a, b) => {
            const aTime = a.lastTimestamp?.getTime() ?? a.eventTime?.getTime() ?? 0;
            const bTime = b.lastTimestamp?.getTime() ?? b.eventTime?.getTime() ?? 0;
            return bTime - aTime;
          })
          .map(e => ({
            type: e.type,
            reason: e.reason,
            message: e.message,
            count: e.count,
            namespace: e.metadata?.namespace,
            involvedObject: {
              kind: e.involvedObject.kind,
              name: e.involvedObject.name,
              namespace: e.involvedObject.namespace,
            },
            firstTime: e.firstTimestamp,
            lastTime: e.lastTimestamp ?? e.eventTime,
            source: e.source,
          }));

        return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing events: ${msg}` }], isError: true };
      }
    }
  );
}
