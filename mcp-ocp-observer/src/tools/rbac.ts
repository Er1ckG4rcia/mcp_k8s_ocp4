import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rbacApi, coreApi, customApi } from '../k8s-client.js';

// Schemas at module level to prevent TS2589
const listRolesSchema = {
  namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
};

const listRoleBindingsSchema = {
  namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
  subjectName: z.string().optional().describe(
    'Filter bindings that reference a specific subject (user, group, or SA name).'
  ),
};

const listClusterRolesSchema = {
  labelSelector: z.string().optional().describe('Label selector to filter ClusterRoles'),
};

const listClusterRoleBindingsSchema = {
  subjectName: z.string().optional().describe(
    'Filter bindings that reference a specific subject (user, group, or SA name).'
  ),
};

const listServiceAccountsSchema = {
  namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
};

const getRbacForSubjectSchema = {
  subjectName: z.string().describe('User, Group, or ServiceAccount name to analyse'),
  subjectKind: z.enum(['User', 'Group', 'ServiceAccount']).describe('Kind of the subject'),
  namespace: z.string().optional().describe(
    'Scope the search to a specific namespace. Omit to search cluster-wide.'
  ),
};

export function registerRbacTools(server: McpServer): void {
  // ─── list-roles ───────────────────────────────────────────────────────────
  server.tool(
    'list-roles',
    'List namespaced Roles in a namespace or across all namespaces. ' +
    'Shows the API groups, resources, and verbs each Role grants. ' +
    'Use to audit namespace-scoped permissions and identify overly permissive roles.',
    listRolesSchema,
    async ({ namespace }) => {
      try {
        const result = namespace
          ? await rbacApi.listNamespacedRole(namespace)
          : await rbacApi.listRoleForAllNamespaces();

        const roles = result.body.items.map(r => ({
          name: r.metadata?.name,
          namespace: r.metadata?.namespace,
          rules: r.rules?.map(rule => ({
            apiGroups: rule.apiGroups,
            resources: rule.resources,
            resourceNames: rule.resourceNames,
            verbs: rule.verbs,
          })),
          createdAt: r.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(roles, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing Roles: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-clusterroles ────────────────────────────────────────────────────
  server.tool(
    'list-clusterroles',
    'List ClusterRoles (cluster-wide roles). Shows rules with API groups, resources, and verbs. ' +
    'Useful for identifying overly broad cluster-wide permissions. ' +
    'Filter out system roles with labelSelector (e.g. kubernetes.io/bootstrapping!=rbac-defaults).',
    listClusterRolesSchema,
    async ({ labelSelector }) => {
      try {
        const result = await rbacApi.listClusterRole(
          undefined, undefined, undefined, undefined, labelSelector
        );

        const roles = result.body.items.map(r => ({
          name: r.metadata?.name,
          aggregationRule: r.aggregationRule,
          rules: r.rules?.map(rule => ({
            apiGroups: rule.apiGroups,
            resources: rule.resources,
            resourceNames: rule.resourceNames,
            verbs: rule.verbs,
            nonResourceURLs: rule.nonResourceURLs,
          })),
          labels: r.metadata?.labels,
          createdAt: r.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(roles, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing ClusterRoles: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-rolebindings ────────────────────────────────────────────────────
  server.tool(
    'list-rolebindings',
    'List RoleBindings in a namespace or across all namespaces. ' +
    'Shows which subjects (users, groups, service accounts) are bound to which roles. ' +
    'Optionally filter by subject name to find all permissions for a specific entity.',
    listRoleBindingsSchema,
    async ({ namespace, subjectName }) => {
      try {
        const result = namespace
          ? await rbacApi.listNamespacedRoleBinding(namespace)
          : await rbacApi.listRoleBindingForAllNamespaces();

        let bindings = result.body.items;

        if (subjectName) {
          bindings = bindings.filter(b =>
            b.subjects?.some(s => s.name === subjectName)
          );
        }

        const mapped = bindings.map(b => ({
          name: b.metadata?.name,
          namespace: b.metadata?.namespace,
          roleRef: {
            kind: b.roleRef.kind,
            name: b.roleRef.name,
            apiGroup: b.roleRef.apiGroup,
          },
          subjects: b.subjects?.map(s => ({
            kind: s.kind,
            name: s.name,
            namespace: s.namespace,
          })),
          createdAt: b.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing RoleBindings: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-clusterrolebindings ─────────────────────────────────────────────
  server.tool(
    'list-clusterrolebindings',
    'List ClusterRoleBindings (cluster-wide). Shows subjects bound to ClusterRoles. ' +
    'Optionally filter by subject name. Use to find who has cluster-admin or other ' +
    'privileged cluster-wide roles — key for RBAC security audits.',
    listClusterRoleBindingsSchema,
    async ({ subjectName }) => {
      try {
        const result = await rbacApi.listClusterRoleBinding();

        let bindings = result.body.items;

        if (subjectName) {
          bindings = bindings.filter(b =>
            b.subjects?.some(s => s.name === subjectName)
          );
        }

        const mapped = bindings.map(b => ({
          name: b.metadata?.name,
          roleRef: {
            kind: b.roleRef.kind,
            name: b.roleRef.name,
          },
          subjects: b.subjects?.map(s => ({
            kind: s.kind,
            name: s.name,
            namespace: s.namespace,
          })),
          createdAt: b.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing ClusterRoleBindings: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-serviceaccounts ─────────────────────────────────────────────────
  server.tool(
    'list-serviceaccounts',
    'List ServiceAccounts in a namespace or across all namespaces. ' +
    'Shows associated secrets and image pull secrets. ' +
    'Use to identify orphaned SAs, SAs with excessive secrets, or SAs missing pull secrets.',
    listServiceAccountsSchema,
    async ({ namespace }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedServiceAccount(namespace)
          : await coreApi.listServiceAccountForAllNamespaces();

        const sas = result.body.items.map(sa => ({
          name: sa.metadata?.name,
          namespace: sa.metadata?.namespace,
          secrets: sa.secrets?.map(s => s.name),
          imagePullSecrets: sa.imagePullSecrets?.map(s => s.name),
          automountServiceAccountToken: sa.automountServiceAccountToken,
          labels: sa.metadata?.labels,
          annotations: sa.metadata?.annotations
            ? Object.fromEntries(
                Object.entries(sa.metadata.annotations).filter(
                  ([k]) => !k.startsWith('kubectl.kubernetes.io')
                )
              )
            : {},
          createdAt: sa.metadata?.creationTimestamp,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(sas, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing ServiceAccounts: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-ocp-users ───────────────────────────────────────────────────────
  server.tool(
    'list-ocp-users',
    'List OpenShift Users (user.openshift.io/v1). ' +
    'Shows identities and group memberships. ' +
    'Use to audit who has access to the cluster and identify stale or unused accounts.',
    {},
    async () => {
      try {
        const result = await customApi.listClusterCustomObject(
          'user.openshift.io', 'v1', 'users'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        const users = (body.items ?? []).map((u: Record<string, unknown>) => {
          const meta = u.metadata as Record<string, unknown> | undefined;
          return {
            name: meta?.name,
            fullName: u.fullName,
            identities: u.identities,
            groups: u.groups,
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing OCP Users: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-ocp-groups ──────────────────────────────────────────────────────
  server.tool(
    'list-ocp-groups',
    'List OpenShift Groups (user.openshift.io/v1). ' +
    'Shows group members. Use to audit group-based RBAC assignments and identify ' +
    'groups with unexpected members or groups bound to privileged ClusterRoles.',
    {},
    async () => {
      try {
        const result = await customApi.listClusterCustomObject(
          'user.openshift.io', 'v1', 'groups'
        );

        const body = result.body as { items?: Record<string, unknown>[] };
        const groups = (body.items ?? []).map((g: Record<string, unknown>) => {
          const meta = g.metadata as Record<string, unknown> | undefined;
          return {
            name: meta?.name,
            users: g.users,
            labels: meta?.labels,
            annotations: meta?.annotations,
            createdAt: meta?.creationTimestamp,
          };
        });

        return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing OCP Groups: ${msg}` }], isError: true };
      }
    }
  );

  // ─── get-rbac-for-subject ─────────────────────────────────────────────────
  server.tool(
    'get-rbac-for-subject',
    'Find ALL RoleBindings and ClusterRoleBindings referencing a specific User, Group, ' +
    'or ServiceAccount. Returns a consolidated view of every permission assigned to that subject. ' +
    'This is the primary tool for RBAC analysis — use it to understand the full permission ' +
    'surface of a specific identity and identify opportunities for least-privilege improvement.',
    getRbacForSubjectSchema,
    async ({ subjectName, subjectKind, namespace }) => {
      try {
        const [rbResult, crbResult] = await Promise.all([
          namespace
            ? rbacApi.listNamespacedRoleBinding(namespace)
            : rbacApi.listRoleBindingForAllNamespaces(),
          rbacApi.listClusterRoleBinding(),
        ]);

        const matchingRBs = rbResult.body.items
          .filter(b => b.subjects?.some(s => s.name === subjectName && s.kind === subjectKind))
          .map(b => ({
            type: 'RoleBinding',
            name: b.metadata?.name,
            namespace: b.metadata?.namespace,
            roleRef: { kind: b.roleRef.kind, name: b.roleRef.name },
          }));

        const matchingCRBs = crbResult.body.items
          .filter(b => b.subjects?.some(s => s.name === subjectName && s.kind === subjectKind))
          .map(b => ({
            type: 'ClusterRoleBinding',
            name: b.metadata?.name,
            roleRef: { kind: b.roleRef.kind, name: b.roleRef.name },
          }));

        const summary = {
          subject: { name: subjectName, kind: subjectKind },
          totalBindings: matchingRBs.length + matchingCRBs.length,
          roleBindings: matchingRBs,
          clusterRoleBindings: matchingCRBs,
          analysisHint: matchingCRBs.length > 0
            ? `⚠️ This subject has ${matchingCRBs.length} cluster-wide binding(s). Review if cluster scope is truly required.`
            : '✅ No cluster-wide bindings found.',
        };

        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error analysing RBAC for ${subjectKind}/${subjectName}: ${msg}` }], isError: true };
      }
    }
  );
}
