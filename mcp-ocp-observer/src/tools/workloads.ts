import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { appsApi } from '../k8s-client.js';

export function registerWorkloadTools(server: McpServer): void {
  // ─── list-deployments ─────────────────────────────────────────────────────
  server.tool(
    'list-deployments',
    'List Deployments in a namespace or across all namespaces. ' +
    'Shows desired vs ready replicas, available conditions, and rollout status. ' +
    'Use to identify degraded deployments with unavailable replicas.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
      labelSelector: z.string().optional().describe('Label selector (e.g. app=my-app)'),
    },
    async ({ namespace, labelSelector }) => {
      try {
        const result = namespace
          ? await appsApi.listNamespacedDeployment(namespace, undefined, undefined, undefined, undefined, labelSelector)
          : await appsApi.listDeploymentForAllNamespaces(undefined, undefined, undefined, labelSelector);

        const deployments = result.body.items.map(d => ({
          name: d.metadata?.name,
          namespace: d.metadata?.namespace,
          replicas: {
            desired: d.spec?.replicas ?? 0,
            ready: d.status?.readyReplicas ?? 0,
            available: d.status?.availableReplicas ?? 0,
            updatedReplicas: d.status?.updatedReplicas ?? 0,
          },
          strategy: d.spec?.strategy?.type,
          conditions: d.status?.conditions?.map(c => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })),
          createdAt: d.metadata?.creationTimestamp,
          labels: d.metadata?.labels,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(deployments, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing deployments: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-deployment ───────────────────────────────────────────────────────
  server.tool(
    'get-deployment',
    'Get full details of a specific Deployment including pod template spec, ' +
    'rollout strategy, replica status, conditions, and resource requirements. ' +
    'Use for in-depth analysis of a specific workload.',
    {
      namespace: z.string().describe('Deployment namespace'),
      name: z.string().describe('Deployment name'),
    },
    async ({ namespace, name }) => {
      try {
        const result = await appsApi.readNamespacedDeployment(name, namespace);
        const deploy = result.body;
        if (deploy.metadata) delete (deploy.metadata as Record<string, unknown>).managedFields;
        return { content: [{ type: 'text', text: JSON.stringify(deploy, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting deployment ${namespace}/${name}: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-statefulsets ────────────────────────────────────────────────────
  server.tool(
    'list-statefulsets',
    'List StatefulSets in a namespace or across all namespaces. ' +
    'Shows replica counts and update strategy. Useful for diagnosing database and ' +
    'stateful workload availability issues.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
    },
    async ({ namespace }) => {
      try {
        const result = namespace
          ? await appsApi.listNamespacedStatefulSet(namespace)
          : await appsApi.listStatefulSetForAllNamespaces();

        const sets = result.body.items.map(s => ({
          name: s.metadata?.name,
          namespace: s.metadata?.namespace,
          replicas: {
            desired: s.spec?.replicas ?? 0,
            ready: s.status?.readyReplicas ?? 0,
            currentReplicas: s.status?.currentReplicas ?? 0,
            updatedReplicas: s.status?.updatedReplicas ?? 0,
          },
          serviceName: s.spec?.serviceName,
          updateStrategy: s.spec?.updateStrategy?.type,
          conditions: s.status?.conditions?.map(c => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })),
          createdAt: s.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(sets, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing statefulsets: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-replicasets ─────────────────────────────────────────────────────
  server.tool(
    'list-replicasets',
    'List ReplicaSets in a namespace. Shows replica counts, owner reference (parent Deployment), ' +
    'and conditions. Useful for diagnosing failed rollouts where old ReplicaSets are stuck.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
    },
    async ({ namespace }) => {
      try {
        const result = namespace
          ? await appsApi.listNamespacedReplicaSet(namespace)
          : await appsApi.listReplicaSetForAllNamespaces();

        const sets = result.body.items.map(rs => ({
          name: rs.metadata?.name,
          namespace: rs.metadata?.namespace,
          replicas: {
            desired: rs.spec?.replicas ?? 0,
            ready: rs.status?.readyReplicas ?? 0,
            available: rs.status?.availableReplicas ?? 0,
          },
          ownedBy: rs.metadata?.ownerReferences?.map(o => ({ kind: o.kind, name: o.name })),
          conditions: rs.status?.conditions?.map(c => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })),
          createdAt: rs.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(sets, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing replicasets: ${msg}` }], isError: true };
      }
    }
  );
}
