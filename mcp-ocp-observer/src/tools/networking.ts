import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi, customApi } from '../k8s-client.js';

export function registerNetworkingTools(server: McpServer): void {
  // ─── list-services ────────────────────────────────────────────────────────
  server.tool(
    'list-services',
    'List Kubernetes Services in a namespace or across all namespaces. ' +
    'Shows type (ClusterIP/NodePort/LoadBalancer), cluster IP, port mappings, and selectors. ' +
    'Use to verify service configuration and port bindings.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
      labelSelector: z.string().optional().describe('Label selector to filter services'),
    },
    async ({ namespace, labelSelector }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedService(namespace, undefined, undefined, undefined, undefined, labelSelector)
          : await coreApi.listServiceForAllNamespaces(undefined, undefined, undefined, labelSelector);

        const services = result.body.items.map(s => ({
          name: s.metadata?.name,
          namespace: s.metadata?.namespace,
          type: s.spec?.type,
          clusterIP: s.spec?.clusterIP,
          externalIP: s.spec?.externalIPs,
          loadBalancerIP: s.status?.loadBalancer?.ingress?.map(i => i.ip ?? i.hostname),
          ports: s.spec?.ports?.map(p => ({
            name: p.name,
            protocol: p.protocol,
            port: p.port,
            targetPort: p.targetPort,
            nodePort: p.nodePort,
          })),
          selector: s.spec?.selector,
          createdAt: s.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing services: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-routes ──────────────────────────────────────────────────────────
  server.tool(
    'list-routes',
    'List OpenShift Routes in a namespace or across all namespaces. ' +
    'Shows host, TLS termination policy, backing service, and admission status. ' +
    'Use to verify external URL exposure and TLS configuration.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
    },
    async ({ namespace }) => {
      try {
        // OpenShift Routes use the route.openshift.io/v1 API group
        const result = namespace
          ? await customApi.listNamespacedCustomObject(
              'route.openshift.io', 'v1', namespace, 'routes'
            )
          : await customApi.listClusterCustomObject(
              'route.openshift.io', 'v1', 'routes'
            );

        const body = result.body as { items?: Record<string, unknown>[] };
        const items = body.items ?? [];

        const routes = items.map((r: Record<string, unknown>) => {
          const meta = r.metadata as Record<string, unknown> | undefined;
          const spec = r.spec as Record<string, unknown> | undefined;
          const status = r.status as Record<string, unknown> | undefined;
          const tls = spec?.tls as Record<string, unknown> | undefined;
          const to = spec?.to as Record<string, unknown> | undefined;

          return {
            name: meta?.name,
            namespace: meta?.namespace,
            host: spec?.host,
            path: spec?.path ?? '/',
            tls: tls
              ? {
                  termination: tls.termination,
                  insecureEdgeTerminationPolicy: tls.insecureEdgeTerminationPolicy,
                }
              : null,
            to: {
              kind: to?.kind,
              name: to?.name,
            },
            admitted: (status?.ingress as Record<string, unknown>[] | undefined)?.map(
              (i: Record<string, unknown>) => ({
                host: i.host,
                conditions: i.conditions,
              })
            ),
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(routes, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing routes: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
