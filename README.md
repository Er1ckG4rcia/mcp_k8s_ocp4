# mcp-ocp-observer

MCP (Model Context Protocol) server for OpenShift 4 cluster observability and troubleshooting. Exposes cluster state — pods, nodes, deployments, routes, RBAC, machines, and more — as MCP tools that AI assistants (Claude, Copilot, etc.) can call directly.

The server runs as a Deployment inside OpenShift, uses the pod's ServiceAccount to authenticate against the Kubernetes API, and exposes a single HTTP endpoint (`/mcp`) protected by a static bearer token.

---

## Table of Contents

- [Architecture](#architecture)
- [Available Tools](#available-tools)
- [Deploying to OpenShift](#deploying-to-openshift)
  - [Prerequisites](#prerequisites)
  - [1. Build and Push the Image](#1-build-and-push-the-image)
  - [2. Apply the OCP Manifests](#2-apply-the-ocp-manifests)
  - [3. Create the Auth Secret](#3-create-the-auth-secret)
  - [4. Verify the Deployment](#4-verify-the-deployment)
  - [5. Connect an MCP Client](#5-connect-an-mcp-client)
- [Environment Variables](#environment-variables)
- [Security Notes](#security-notes)
- [Developing New Tools](#developing-new-tools)
  - [Project Structure](#project-structure)
  - [Step-by-Step: Adding a Tool File](#step-by-step-adding-a-tool-file)
  - [Conventions and Patterns](#conventions-and-patterns)
  - [Local Development](#local-development)
  - [Building Locally](#building-locally)

---

## Architecture

```
MCP Client (Claude / IDE)
        │  HTTP POST/GET
        │  Authorization: Bearer <token>
        ▼
  OpenShift Route  (HTTPS)
        │
        ▼
  Express HTTP Server  :8080
        │
        ├── GET  /health          → liveness/readiness probe (no auth)
        └── ALL  /mcp             → bearer token check → StreamableHTTPServerTransport
                                        │
                                        ▼
                                  McpServer (one per request — stateless)
                                        │
                                        ├── registerPodTools
                                        ├── registerNodeTools
                                        ├── registerNodeLogTools
                                        ├── registerEventTools
                                        ├── registerWorkloadTools
                                        ├── registerNetworkingTools
                                        ├── registerNamespaceTools
                                        ├── registerStorageTools
                                        ├── registerConfigResourceTools
                                        ├── registerRbacTools
                                        └── registerMachineTools
                                                │
                                                ▼
                                    @kubernetes/client-node
                                    (in-cluster ServiceAccount)
                                                │
                                                ▼
                                      Kubernetes / OCP API
```

**Key design decisions:**
- **Stateless transport** — a fresh `McpServer` is created per HTTP request. No session is maintained.
- **Read-only** — all tools use only `get` and `list` verbs. No mutations are possible.
- **Secret values are never returned** — ConfigMaps and Secrets expose keys only.
- **Node logs are streamed with a rolling buffer** — memory stays bounded regardless of log volume.

---

## Available Tools

| Tool | Description |
|---|---|
| `list-pods` | List pods by namespace, label selector, or field selector. Shows phase, restart counts, container states. |
| `get-pod` | Full pod spec and status for a specific pod. |
| `get-pod-logs` | Container logs with tail, previous-container, and time-range filtering. |
| `list-nodes` | All cluster nodes with conditions, capacity, allocatable resources, taints, and runtime info. |
| `get-node` | Full node details for deep-dive health analysis. |
| `get-node-logs` | Systemd journal (or audit/container) logs from a node via kubelet proxy. Filter by unit, lines, time. |
| `list-node-log-units` | Discover available systemd units on a node before calling `get-node-logs`. |
| `list-events` | Cluster or namespace events filtered by involved object or type (Warning/Normal). |
| `list-deployments` | Deployments with desired vs ready replica counts and rollout conditions. |
| `get-deployment` | Full deployment spec including pod template and rollout strategy. |
| `list-statefulsets` | StatefulSets with replica counts and update strategy. |
| `list-replicasets` | ReplicaSets with owner references — useful for diagnosing stuck rollouts. |
| `list-services` | Kubernetes Services with type, ClusterIP, ports, and selectors. |
| `list-routes` | OpenShift Routes with host, TLS termination policy, and admission status. |
| `list-namespaces` | All namespaces/projects with phase. Terminating namespaces often have stuck finalizers. |
| `list-projects` | OpenShift Projects with display name, description, and requester. |
| `list-pvs` | PersistentVolumes with capacity, access modes, reclaim policy, and binding status. |
| `list-pvcs` | PersistentVolumeClaims with phase. Pending PVCs are a common pod scheduling root cause. |
| `list-configmaps` | ConfigMap names and data keys (values are not returned). |
| `list-secret-names` | Secret names, types, and data keys. Values are never returned. |
| `list-roles` | Namespaced Roles with rules (API groups, resources, verbs). |
| `list-clusterroles` | ClusterRoles with rules. Filter out system roles with label selectors. |
| `list-rolebindings` | RoleBindings with subjects. Filter by subject name. |
| `list-clusterrolebindings` | ClusterRoleBindings. Filter by subject name to audit cluster-wide permissions. |
| `list-serviceaccounts` | ServiceAccounts with associated secrets and image pull secrets. |
| `list-ocp-users` | OpenShift Users with identities and group memberships. |
| `list-ocp-groups` | OpenShift Groups with member lists. |
| `get-rbac-for-subject` | All RoleBindings and ClusterRoleBindings for a specific User, Group, or ServiceAccount. |
| `list-machinesets` | MachineSets with replica counts, instance type, region, zone, and AMI/image. |
| `get-machineset` | Full MachineSet spec including provider config. |
| `list-machines` | Machines with phase, node reference, instance ID, and error messages. Filter by MachineSet or phase. |
| `list-machineconfigs` | MachineConfigs with roles, kernel arguments, extensions, and configured file paths. |
| `list-machineconfigpools` | MachineConfigPools with update status and degraded machine counts. |

---

## Deploying to OpenShift

### Prerequisites

- OpenShift 4.x cluster with `cluster-admin` or equivalent for applying ClusterRole/ClusterRoleBinding
- [`oc` CLI](https://docs.openshift.com/container-platform/latest/cli_reference/openshift_cli/getting-started-cli.html) logged in
- [Podman](https://podman.io/) for building and pushing the image
- A container registry (Quay.io, Docker Hub, or an internal OCP registry)

### 1. Build and Push the Image

From the `mcp-ocp-observer/` directory, run the interactive build script:

```bash
cd mcp-ocp-observer
chmod +x build-push.sh
./build-push.sh
```

The script will prompt for registry host, organization, image name, tag, and credentials, then build and push the image using Podman.

### 2. Apply the OCP Manifests

Edit `mcp-ocp-observer/ocp/deployment.yaml` and replace the image placeholder with your actual image:

```yaml
image: <your-registry>/<your-org>/mcp-ocp-observer:<tag>
```

Apply all manifests in order:

```bash
oc apply -f mcp-ocp-observer/ocp/namespace.yaml
oc apply -f mcp-ocp-observer/ocp/serviceaccount.yaml
oc apply -f mcp-ocp-observer/ocp/clusterrole.yaml
oc apply -f mcp-ocp-observer/ocp/clusterrolebinding.yaml
oc apply -f mcp-ocp-observer/ocp/configmap.yaml
oc apply -f mcp-ocp-observer/ocp/service.yaml
oc apply -f mcp-ocp-observer/ocp/route.yaml
```

Or apply the entire directory at once (requires the secret to exist first — see next step):

```bash
oc apply -f mcp-ocp-observer/ocp/
```

### 3. Create the Auth Secret

Generate a strong random token and create the secret. **Never commit a real token to the repository.**

```bash
oc create secret generic mcp-ocp-observer-secret \
  --from-literal=MCP_AUTH_TOKEN="$(openssl rand -base64 48)" \
  -n validacao-infra
```

Then apply the Deployment:

```bash
oc apply -f mcp-ocp-observer/ocp/deployment.yaml
```

### 4. Verify the Deployment

```bash
# Check pod is running
oc get pods -n validacao-infra -l app=mcp-ocp-observer

# Check logs
oc logs -n validacao-infra deployment/mcp-ocp-observer

# Test the health endpoint (no auth required)
curl https://$(oc get route mcp-ocp-observer -n validacao-infra -o jsonpath='{.spec.host}')/health
```

Expected health response:
```json
{"status":"ok","version":"1.0.0","name":"mcp-ocp-observer"}
```

### 5. Connect an MCP Client

Configure your MCP client (e.g. Claude Code, VS Code Copilot) with:

| Field | Value |
|---|---|
| Transport | `http` (Streamable HTTP) |
| URL | `https://<route-host>/mcp` |
| Header | `Authorization: Bearer <your-token>` |

Example for Claude Code (`~/.claude/mcp_servers.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "ocp-observer": {
      "type": "http",
      "url": "https://<route-host>/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

---

## Environment Variables

All configuration is passed via environment variables. Non-sensitive values come from the ConfigMap; the auth token comes from the Secret.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port the server listens on |
| `MCP_SERVER_NAME` | `mcp-ocp-observer` | Name reported in MCP server metadata |
| `MCP_SERVER_VERSION` | `1.0.0` | Version reported in MCP server metadata |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `MCP_AUTH_TOKEN` | _(unset)_ | Static bearer token clients must send. If unset, auth is disabled — **never run without this in production.** |

---

## Security Notes

- The server is **read-only by design**. The ClusterRole grants only `get` and `list` verbs.
- `nodes/proxy` is required for node journal log access. It grants broad kubelet API access; the MCP tool layer restricts it to log retrieval only.
- Secret values are never returned by any tool — only names, types, and data keys are exposed.
- The container runs as non-root (UID 1001) with a read-only root filesystem, dropped capabilities, and `RuntimeDefault` seccomp profile.
- The bearer token should be rotated by recreating the Kubernetes Secret and restarting the pod.

---

## Developing New Tools

### Project Structure

```
mcp-ocp-observer/
├── src/
│   ├── index.ts          # Express server entry point, /health and /mcp endpoints
│   ├── server.ts         # McpServer factory — imports and registers all tool groups
│   ├── config.ts         # Environment variable config
│   ├── auth.ts           # Bearer token middleware
│   ├── k8s-client.ts     # Kubernetes API clients (coreApi, appsApi, rbacApi, customApi)
│   └── tools/
│       ├── pods.ts
│       ├── nodes.ts
│       ├── node-logs.ts
│       ├── events.ts
│       ├── workloads.ts
│       ├── networking.ts
│       ├── namespaces.ts
│       ├── storage.ts
│       ├── config-resources.ts
│       ├── rbac.ts
│       └── machines.ts
├── ocp/                  # Kubernetes/OCP manifests
├── Dockerfile
├── build-push.sh
├── package.json
└── tsconfig.json
```

### Step-by-Step: Adding a Tool File

**1. Create `src/tools/my-resource.ts`**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { coreApi } from '../k8s-client.js';   // or appsApi, rbacApi, customApi

// Define schemas at MODULE LEVEL — not inside the function.
// Inline schemas trigger TS2589 (excessively deep type instantiation).
const listMyResourceSchema = {
  namespace: z.string().optional().describe('Namespace to filter. Omit for all namespaces.'),
};

export function registerMyResourceTools(server: McpServer): void {
  server.tool(
    'list-my-resources',
    'One or two sentences describing what this tool returns and when to use it.',
    listMyResourceSchema,
    async ({ namespace }) => {
      try {
        const result = namespace
          ? await coreApi.listNamespacedSomething(namespace)
          : await coreApi.listSomethingForAllNamespaces();

        const items = result.body.items.map(item => ({
          name: item.metadata?.name,
          namespace: item.metadata?.namespace,
          // Map only the fields that are useful — avoid dumping the full object.
          // Always delete managedFields when returning a full resource object.
        }));

        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing my-resources: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
```

**2. Register it in `src/server.ts`**

```typescript
import { registerMyResourceTools } from './tools/my-resource.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ ... });

  // existing registrations ...
  registerMyResourceTools(server);   // add this line

  return server;
}
```

**3. Add RBAC permissions in `ocp/clusterrole.yaml`**

```yaml
- apiGroups: [""]
  resources:
    - myresources
  verbs: ["get", "list"]
```

Apply the updated ClusterRole:

```bash
oc apply -f mcp-ocp-observer/ocp/clusterrole.yaml
```

### Conventions and Patterns

**Schemas must be at module level**

Defining Zod schemas inline inside `registerXxx()` causes TypeScript error `TS2589: Type instantiation is excessively deep`. Always declare them as module-level constants:

```typescript
// ✅ correct
const mySchema = { name: z.string() };
export function registerFoo(server: McpServer) {
  server.tool('foo', 'desc', mySchema, handler);
}

// ❌ causes TS2589
export function registerFoo(server: McpServer) {
  server.tool('foo', 'desc', { name: z.string() }, handler);
}
```

**Error handling**

Every tool handler must have a `try/catch`. Return `isError: true` with a descriptive message — never let an exception propagate to the transport layer:

```typescript
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error listing foo: ${msg}` }],
    isError: true,
  };
}
```

**Custom resources (OpenShift-specific)**

Use `customApi` (the `CustomObjectsApi` client) for any resource not in `core/v1`, `apps/v1`, or `rbac.authorization.k8s.io/v1`:

```typescript
import { customApi } from '../k8s-client.js';

// Cluster-scoped resource
const result = await customApi.listClusterCustomObject(
  'route.openshift.io', 'v1', 'routes'
);

// Namespace-scoped resource
const result = await customApi.listNamespacedCustomObject(
  'machine.openshift.io', 'v1beta1', namespace, 'machinesets'
);

// The response body is untyped — cast it and navigate with optional chaining:
const body = result.body as { items?: Record<string, unknown>[] };
```

**Output discipline**

- Map API responses to a curated subset of fields. Full Kubernetes objects are too verbose for LLM context.
- Always delete `managedFields` when returning a full resource: `delete (resource.metadata as Record<string, unknown>).managedFields`.
- Never return Secret values. Return only keys (`Object.keys(secret.data ?? {})`).
- ConfigMap data values should also be omitted from list operations — keys only.

**Tool description quality**

The tool description is what the LLM uses to decide which tool to call. Write it to answer: *what does this return, and when should I call it?*

```typescript
// ✅ good
'List OpenShift Routes. Shows host, TLS termination, and admission status. ' +
'Use to verify external URL exposure and TLS configuration.'

// ❌ too vague
'Get routes from OpenShift.'
```

### Local Development

Install dependencies:

```bash
cd mcp-ocp-observer
npm install
```

Run against a live cluster (reads `~/.kube/config` or `KUBECONFIG`):

```bash
npm run dev
```

The server starts on `http://localhost:8080`. Auth is disabled when `MCP_AUTH_TOKEN` is not set.

Test the health endpoint:

```bash
curl http://localhost:8080/health
```

Test an MCP tool call:

```bash
curl -s -X POST http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list-namespaces",
      "arguments": {}
    }
  }'
```

Type-check without building:

```bash
npm run typecheck
```

### Building Locally

```bash
npm run build          # outputs dist/index.js
node dist/index.js     # run the compiled server
```
