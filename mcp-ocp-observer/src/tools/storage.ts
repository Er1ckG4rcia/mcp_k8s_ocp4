import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';

export function registerStorageTools(server: McpServer): void {
  // ─── list-pvs ─────────────────────────────────────────────────────────────
  server.tool(
    'list-pvs',
    'List all PersistentVolumes in the cluster. Shows capacity, access modes, ' +
    'reclaim policy, volume mode, storage class, and binding status. ' +
    'Use to identify Released, Failed, or unbound PVs causing storage issues.',
    {
      storageClass: z.string().optional().describe('Filter by StorageClass name'),
    },
    async ({ storageClass }) => {
      try {
        const result = await coreApi.listPersistentVolume();

        let pvs = result.body.items;

        if (storageClass) {
          pvs = pvs.filter(pv => pv.spec?.storageClassName === storageClass);
        }

        const mapped = pvs.map(pv => ({
          name: pv.metadata?.name,
          capacity: pv.spec?.capacity,
          accessModes: pv.spec?.accessModes,
          reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy,
          volumeMode: pv.spec?.volumeMode,
          storageClass: pv.spec?.storageClassName,
          phase: pv.status?.phase,
          reason: pv.status?.reason,
          boundTo: pv.spec?.claimRef
            ? {
                namespace: pv.spec.claimRef.namespace,
                name: pv.spec.claimRef.name,
              }
            : null,
          createdAt: pv.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing PersistentVolumes: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-pvcs ────────────────────────────────────────────────────────────
  server.tool(
    'list-pvcs',
    'List PersistentVolumeClaims in a namespace or across all namespaces. ' +
    'Shows requested storage, access modes, bound volume, and phase. ' +
    'Pending PVCs indicate no matching PV is available — common cause of pod scheduling failures.',
    {
      namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
      storageClass: z.string().optional().describe('Filter by StorageClass name'),
    },
    async ({ namespace, storageClass }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedPersistentVolumeClaim(namespace)
          : await coreApi.listPersistentVolumeClaimForAllNamespaces();

        let pvcs = result.body.items;

        if (storageClass) {
          pvcs = pvcs.filter(pvc => pvc.spec?.storageClassName === storageClass);
        }

        const mapped = pvcs.map(pvc => ({
          name: pvc.metadata?.name,
          namespace: pvc.metadata?.namespace,
          phase: pvc.status?.phase,
          storageClass: pvc.spec?.storageClassName,
          requestedStorage: pvc.spec?.resources?.requests?.['storage'],
          allocatedStorage: pvc.status?.capacity?.['storage'],
          accessModes: pvc.spec?.accessModes,
          volumeMode: pvc.spec?.volumeMode,
          volumeName: pvc.spec?.volumeName,
          conditions: pvc.status?.conditions?.map(c => ({
            type: c.type,
            status: c.status,
            reason: c.reason,
            message: c.message,
          })),
          createdAt: pvc.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing PersistentVolumeClaims: ${msg}` }], isError: true };
      }
    }
  );
}
