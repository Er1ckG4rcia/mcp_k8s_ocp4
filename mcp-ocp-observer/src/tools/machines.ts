import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { customApi } from '../k8s-client.js';

// Schemas at module level to prevent TS2589
const listMachineSetsSchema = {
  namespace: z.string().optional().describe(
    'Namespace to filter. Default: openshift-machine-api'
  ),
};

const getMachineSetSchema = {
  name: z.string().describe('MachineSet name'),
  namespace: z.string().optional().describe(
    'Namespace. Default: openshift-machine-api'
  ),
};

const listMachinesSchema = {
  namespace: z.string().optional().describe(
    'Namespace to filter. Default: openshift-machine-api'
  ),
  machineSet: z.string().optional().describe(
    'Filter machines belonging to a specific MachineSet'
  ),
  phase: z.enum(['Running', 'Provisioning', 'Provisioned', 'Deleting', 'Failed']).optional().describe(
    'Filter machines by phase'
  ),
};

const listMachineConfigsSchema = {
  role: z.string().optional().describe(
    'Filter by machine config role label (e.g. master, worker)'
  ),
};

const listMachineConfigPoolsSchema = {};

export function registerMachineTools(server: McpServer): void {
  const DEFAULT_NS = 'openshift-machine-api';

  // ─── list-machinesets ─────────────────────────────────────────────────────
  server.tool(
    'list-machinesets',
    'List MachineSets in the openshift-machine-api namespace. ' +
    'Shows desired vs ready vs available replicas, instance type, region/zone, and AMI/image. ' +
    'Use to identify MachineSets with degraded replica counts or scaling issues.',
    listMachineSetsSchema,
    async ({ namespace = DEFAULT_NS }) => {
      try {
        const result = await customApi.listNamespacedCustomObject(
          'machine.openshift.io', 'v1beta1', namespace, 'machinesets'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        const sets = (body.items ?? []).map((ms: Record<string, unknown>) => {
          const meta = ms.metadata as Record<string, unknown> | undefined;
          const spec = ms.spec as Record<string, unknown> | undefined;
          const status = ms.status as Record<string, unknown> | undefined;
          const template = spec?.template as Record<string, unknown> | undefined;
          const templateSpec = template?.spec as Record<string, unknown> | undefined;
          const providerSpec = templateSpec?.providerSpec as Record<string, unknown> | undefined;
          const providerValue = providerSpec?.value as Record<string, unknown> | undefined;

          return {
            name: meta?.name,
            namespace: meta?.namespace,
            replicas: {
              desired: spec?.replicas,
              ready: status?.readyReplicas ?? 0,
              available: status?.availableReplicas ?? 0,
              fullyLabeled: status?.fullyLabeledReplicas ?? 0,
            },
            selector: spec?.selector,
            machineTemplate: {
              instanceType: providerValue?.instanceType ?? providerValue?.vmSize ?? providerValue?.machineType,
              region: providerValue?.placement?.region ?? providerValue?.location,
              zone: providerValue?.placement?.availabilityZone ?? providerValue?.zone,
              ami: providerValue?.ami?.id ?? providerValue?.image ?? providerValue?.disks,
            },
            conditions: (status?.conditions as Record<string, unknown>[] | undefined)?.map(c => ({
              type: c.type,
              status: c.status,
              reason: c.reason,
              message: c.message,
            })),
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(sets, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing MachineSets: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-machineset ───────────────────────────────────────────────────────
  server.tool(
    'get-machineset',
    'Get full details of a specific MachineSet including the provider spec ' +
    '(instance type, image, networking, tags). Use to review the full configuration ' +
    'before making scaling decisions or diagnosing provisioning failures.',
    getMachineSetSchema,
    async ({ name, namespace = DEFAULT_NS }) => {
      try {
        const result = await customApi.getNamespacedCustomObject(
          'machine.openshift.io', 'v1beta1', namespace, 'machinesets', name
        );
        const ms = result.body as Record<string, unknown>;
        const meta = ms.metadata as Record<string, unknown> | undefined;
        if (meta) delete (meta as Record<string, unknown>).managedFields;
        return { content: [{ type: 'text', text: JSON.stringify(ms, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting MachineSet ${name}: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-machines ────────────────────────────────────────────────────────
  server.tool(
    'list-machines',
    'List Machines in the openshift-machine-api namespace. ' +
    'Shows phase (Running/Provisioning/Failed/Deleting), associated node, instance ID, ' +
    'and error messages. Use to identify machines stuck in Provisioning/Failed state ' +
    'or machines without an associated node.',
    listMachinesSchema,
    async ({ namespace = DEFAULT_NS, machineSet, phase }) => {
      try {
        const result = await customApi.listNamespacedCustomObject(
          'machine.openshift.io', 'v1beta1', namespace, 'machines'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        let machines = body.items ?? [];

        if (machineSet) {
          machines = machines.filter((m: Record<string, unknown>) => {
            const meta = m.metadata as Record<string, unknown> | undefined;
            const labels = meta?.labels as Record<string, string> | undefined;
            return labels?.['machine.openshift.io/cluster-api-machineset'] === machineSet;
          });
        }

        if (phase) {
          machines = machines.filter((m: Record<string, unknown>) => {
            const status = m.status as Record<string, unknown> | undefined;
            return status?.phase === phase;
          });
        }

        const mapped = machines.map((m: Record<string, unknown>) => {
          const meta = m.metadata as Record<string, unknown> | undefined;
          const spec = m.spec as Record<string, unknown> | undefined;
          const status = m.status as Record<string, unknown> | undefined;
          const labels = meta?.labels as Record<string, string> | undefined;

          return {
            name: meta?.name,
            namespace: meta?.namespace,
            phase: status?.phase,
            nodeRef: status?.nodeRef,
            providerID: spec?.providerID ?? status?.providerID,
            errorReason: status?.errorReason,
            errorMessage: status?.errorMessage,
            machineSet: labels?.['machine.openshift.io/cluster-api-machineset'],
            conditions: (status?.conditions as Record<string, unknown>[] | undefined)?.map(c => ({
              type: c.type,
              status: c.status,
              reason: c.reason,
              message: c.message,
            })),
            addresses: status?.addresses,
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing Machines: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-machineconfigs ──────────────────────────────────────────────────
  server.tool(
    'list-machineconfigs',
    'List MachineConfigs (machineconfiguration.openshift.io/v1). ' +
    'Shows applied roles (master/worker), kernel arguments, OS extensions, and source. ' +
    'Use to understand what customizations are applied to node pools and identify ' +
    'conflicting or redundant configs.',
    listMachineConfigsSchema,
    async ({ role }) => {
      try {
        const result = await customApi.listClusterCustomObject(
          'machineconfiguration.openshift.io', 'v1', 'machineconfigs'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        let configs = body.items ?? [];

        if (role) {
          configs = configs.filter((mc: Record<string, unknown>) => {
            const meta = mc.metadata as Record<string, unknown> | undefined;
            const labels = meta?.labels as Record<string, string> | undefined;
            return labels?.['machineconfiguration.openshift.io/role'] === role;
          });
        }

        const mapped = configs.map((mc: Record<string, unknown>) => {
          const meta = mc.metadata as Record<string, unknown> | undefined;
          const spec = mc.spec as Record<string, unknown> | undefined;
          const labels = meta?.labels as Record<string, string> | undefined;

          return {
            name: meta?.name,
            role: labels?.['machineconfiguration.openshift.io/role'],
            kernelType: spec?.kernelType,
            kernelArguments: spec?.kernelArguments,
            extensions: spec?.extensions,
            osImageURL: spec?.osImageURL,
            // Show file paths only (not content — could be large/sensitive)
            configuredFilePaths: (spec?.config as Record<string, unknown> | undefined)
              ?.storage
                ? ((spec?.config as Record<string, unknown>)?.storage as Record<string, unknown>)
                    ?.files
                  ? ((((spec?.config as Record<string, unknown>)?.storage as Record<string, unknown>)
                      ?.files) as Record<string, unknown>[])?.map(f => (f as Record<string, unknown>).path)
                  : []
              : [],
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing MachineConfigs: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-machineconfigpools ───────────────────────────────────────────────
  server.tool(
    'list-machineconfigpools',
    'List MachineConfigPools (master and worker by default, plus any custom pools). ' +
    'Shows the currently applied MachineConfig, update status, degraded nodes, ' +
    'and whether an update is in progress. ' +
    'A degraded pool means one or more nodes failed to apply a MachineConfig — ' +
    'this blocks cluster upgrades and is a critical issue to diagnose.',
    listMachineConfigPoolsSchema,
    async () => {
      try {
        const result = await customApi.listClusterCustomObject(
          'machineconfiguration.openshift.io', 'v1', 'machineconfigpools'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        const pools = (body.items ?? []).map((mcp: Record<string, unknown>) => {
          const meta = mcp.metadata as Record<string, unknown> | undefined;
          const spec = mcp.spec as Record<string, unknown> | undefined;
          const status = mcp.status as Record<string, unknown> | undefined;
          const config = spec?.configuration as Record<string, unknown> | undefined;
          const statusConfig = status?.configuration as Record<string, unknown> | undefined;

          return {
            name: meta?.name,
            paused: spec?.paused ?? false,
            maxUnavailable: spec?.maxUnavailable,
            machineConfigSelector: spec?.machineConfigSelector,
            machineSelector: spec?.machineSelector,
            currentConfig: statusConfig?.name,
            desiredConfig: config?.name,
            machineCount: status?.machineCount,
            readyMachineCount: status?.readyMachineCount,
            updatedMachineCount: status?.updatedMachineCount,
            unavailableMachineCount: status?.unavailableMachineCount,
            degradedMachineCount: status?.degradedMachineCount,
            conditions: (status?.conditions as Record<string, unknown>[] | undefined)?.map(c => ({
              type: c.type,
              status: c.status,
              reason: c.reason,
              message: c.message,
              lastTransitionTime: c.lastTransitionTime,
            })),
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(pools, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing MachineConfigPools: ${msg}` }], isError: true };
      }
    }
  );
}
