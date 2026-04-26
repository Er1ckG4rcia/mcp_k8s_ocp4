---
description: "Scaffold a new containerized MCP server for Kubernetes or OpenShift. Generates project structure, MCP server code, Dockerfile, and K8s/OCP manifests from a short requirements form."
name: "MCP Server Scaffold"
argument-hint: "Describe the MCP server: name, platform (k8s/ocp), language (ts/python), tools to expose, auth type."
agent: "MCP K8s/OpenShift Expert"
tools: [read, edit, search, execute, todo]
---

You are scaffolding a new containerized MCP server. Follow the [mcp-conventions](./../instructions/mcp-conventions.instructions.md) for all naming, port, env var, and security standards.

## Step 1 — Collect Requirements

Ask the user for the following inputs if not already provided. Present them as a numbered form and wait for answers before generating any files.

```
1. Server name (kebab-case, without "mcp-" prefix): ___________
2. Target platform:
   [ ] Kubernetes (with Ingress)
   [ ] Red Hat OpenShift (with Route)
3. Language/SDK:
   [ ] TypeScript (@modelcontextprotocol/sdk)
   [ ] Python (mcp package)
4. MCP transport:
   [ ] Streamable HTTP — recommended (path: /mcp)
   [ ] SSE — legacy (paths: /sse + /messages)
5. Tools to expose (list each with input/output description):
   - Tool 1: ___________
   - Tool 2: ___________  (add as needed)
6. Resources to expose (optional): ___________
7. Authentication:
   [ ] None
   [ ] Bearer token (static secret)
   [ ] OAuth2
8. Target namespace / OCP project name: ___________
9. Container image registry and org (e.g., quay.io/myorg): ___________
10. Ingress hostname (K8s) OR OCP apps domain (e.g., apps.cluster.example.com): ___________
11. TLS termination:
    [ ] Edge (TLS at Route/Ingress, HTTP inside cluster) — recommended
    [ ] Passthrough
    [ ] Re-encrypt
12. Any external dependencies (databases, APIs, secrets needed)? ___________
```

## Step 2 — Plan

Once requirements are collected, create a task list with `manage_todo_list` covering:
- Project directory structure
- MCP server entry point and tool files
- `Dockerfile` (multi-stage)
- `.dockerignore`
- K8s or OCP manifests (Deployment, Service, ConfigMap, Secret template, Ingress/Route)
- `README-deploy.md` with Quick Start commands

## Step 3 — Generate

Scaffold files in this order:
1. **Project structure** — create all directories first
2. **Config module** — env var reader (`src/config.ts` or `src/config.py`)
3. **Health endpoint** — `GET /health` returning `{ "status": "ok", "version": "<MCP_SERVER_VERSION>" }`
4. **Tool implementations** — one stub per tool declared in requirements, with TODO comments for business logic
5. **MCP server entry point** — wire transport, register tools/resources, bind to `PORT`
6. **Dockerfile** — multi-stage, non-root UID `1001`, `EXPOSE 8080`
7. **.dockerignore**
8. **Kubernetes manifests** (if K8s platform):
   - `k8s/deployment.yaml`
   - `k8s/service.yaml`
   - `k8s/configmap.yaml`
   - `k8s/secret-template.yaml` (values masked as `<REPLACE_ME>`)
   - `k8s/ingress.yaml`
9. **OpenShift manifests** (if OCP platform):
   - `ocp/deployment.yaml`
   - `ocp/service.yaml`
   - `ocp/configmap.yaml`
   - `ocp/secret-template.yaml`
   - `ocp/route.yaml`
10. **package.json / requirements.txt** with pinned runtime dependencies

## Step 4 — Quick Start Summary

After all files are generated, print a **Quick Start** block:

```bash
# Build
docker build -t <registry>/<org>/mcp-<name>:<version> .

# Push
docker push <registry>/<org>/mcp-<name>:<version>

# Deploy (Kubernetes)
kubectl apply -f k8s/ -n <namespace>

# Deploy (OpenShift)
oc apply -f ocp/ -n <project>

# Verify
kubectl get pods -n <namespace> -l app=mcp-<name>
curl https://<hostname>/health
curl https://<hostname>/mcp   # MCP endpoint
```

## Constraints

- DO NOT generate `stdio` transport code for the containerized server
- DO NOT use `latest` image tag in any manifest
- DO NOT store secrets in ConfigMaps
- DO NOT skip `securityContext` or resource limits in Deployment manifests
- Flag every assumption made during generation and ask for confirmation
