import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';

export function registerConfigResourceTools(server: McpServer): void {
  // ─── list-configmaps ──────────────────────────────────────────────────────
  server.tool(
    'list-configmaps',
    'List ConfigMaps in a namespace or across all namespaces. ' +
    'Returns names and data keys only — values are NOT returned. ' +
    'Useful to verify that expected configuration exists without exposing content.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
      labelSelector: z.string().optional().describe('Label selector to filter configmaps'),
    },
    async ({ namespace, labelSelector }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedConfigMap(namespace, undefined, undefined, undefined, undefined, labelSelector)
          : await coreApi.listConfigMapForAllNamespaces(undefined, undefined, undefined, labelSelector);

        const configMaps = result.body.items.map(cm => ({
          name: cm.metadata?.name,
          namespace: cm.metadata?.namespace,
          // Return keys only, not values — values may contain sensitive configuration
          dataKeys: Object.keys(cm.data ?? {}),
          binaryDataKeys: Object.keys(cm.binaryData ?? {}),
          createdAt: cm.metadata?.creationTimestamp,
          labels: cm.metadata?.labels,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(configMaps, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing ConfigMaps: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-secret-names ────────────────────────────────────────────────────
  server.tool(
    'list-secret-names',
    'List Secret NAMES in a namespace. ' +
    '⚠️ SECRET VALUES ARE NEVER RETURNED — only names, types, and keys are shown. ' +
    'Use to verify that a required secret exists before diagnosing a pod mount failure.',
    {
      namespace: z.string().describe(
        'Namespace to list secrets in. Namespace is required to scope this sensitive operation.'
      ),
      secretType: z.string().optional().describe(
        'Filter by secret type (e.g. kubernetes.io/tls, kubernetes.io/dockerconfigjson, Opaque)'
      ),
    },
    async ({ namespace, secretType }) => {
      try {
        const result = await coreApi.listNamespacedSecret(namespace);

        let secrets = result.body.items;
        if (secretType) {
          secrets = secrets.filter(s => s.type === secretType);
        }

        const mapped = secrets.map(s => ({
          name: s.metadata?.name,
          namespace: s.metadata?.namespace,
          type: s.type,
          // Expose keys only — never expose values (base64-encoded sensitive data)
          dataKeys: Object.keys(s.data ?? {}),
          createdAt: s.metadata?.creationTimestamp,
          labels: s.metadata?.labels,
          // ⛔ data and stringData fields are intentionally omitted
        }));

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing Secrets: ${msg}` }], isError: true };
      }
    }
  );
}
