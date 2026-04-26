import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { coreApi, customApi } from '../k8s-client.js';

export function registerNamespaceTools(server: McpServer): void {
  // ─── list-namespaces ──────────────────────────────────────────────────────
  server.tool(
    'list-namespaces',
    'List all Kubernetes namespaces and OpenShift Projects in the cluster. ' +
    'Shows phase (Active/Terminating) and creation time. ' +
    'A namespace stuck in "Terminating" often indicates a finalizer problem.',
    {},
    async () => {
      try {
        const result = await coreApi.listNamespace();

        const namespaces = result.body.items.map(ns => ({
          name: ns.metadata?.name,
          phase: ns.status?.phase,
          labels: ns.metadata?.labels,
          annotations: filterAnnotations(ns.metadata?.annotations),
          createdAt: ns.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(namespaces, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing namespaces: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-projects ────────────────────────────────────────────────────────
  server.tool(
    'list-projects',
    'List all OpenShift Projects via the project.openshift.io API. ' +
    'OpenShift Projects are an extension of Kubernetes Namespaces with additional metadata ' +
    'such as display name and description set by the project requester.',
    {},
    async () => {
      try {
        const result = await customApi.listClusterCustomObject(
          'project.openshift.io', 'v1', 'projects'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        const projects = (body.items ?? []).map((p: Record<string, unknown>) => {
          const meta = p.metadata as Record<string, unknown> | undefined;
          const status = p.status as Record<string, unknown> | undefined;
          const annotations = meta?.annotations as Record<string, string> | undefined;

          return {
            name: meta?.name,
            displayName: annotations?.['openshift.io/display-name'],
            description: annotations?.['openshift.io/description'],
            requester: annotations?.['openshift.io/requester'],
            phase: status?.phase,
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing projects: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}

/** Strip verbose/internal annotations to keep output concise */
function filterAnnotations(annotations?: Record<string, string>): Record<string, string> {
  if (!annotations) return {};
  const SKIP_PREFIXES = ['kubectl.kubernetes.io/last-applied', 'control-plane.alpha.kubernetes.io'];
  return Object.fromEntries(
    Object.entries(annotations).filter(
      ([k]) => !SKIP_PREFIXES.some(prefix => k.startsWith(prefix))
    )
  );
}
