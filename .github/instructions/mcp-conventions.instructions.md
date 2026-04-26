---
description: "Use when creating or editing MCP server code, Dockerfiles, Kubernetes manifests, or OpenShift resources. Enforces naming conventions, port standards, environment variable patterns, and container/OCP best practices for all MCP projects in this workspace."
applyTo: ["**/*.ts", "**/*.py", "**/Dockerfile*", "**/*.yaml", "**/*.yml"]
---

# MCP Workspace Conventions

## Naming Conventions

### Project & Repository
- Repository name: `mcp-<kebab-case-name>` (e.g., `mcp-postgres-query`, `mcp-file-reader`)
- Container image: `<registry>/<org>/mcp-<name>:<semver>` (e.g., `quay.io/myorg/mcp-postgres-query:1.0.0`)
- Never use `latest` tag in manifests — always pin a version

### Kubernetes / OpenShift Resources
| Resource | Pattern | Example |
|---|---|---|
| Deployment | `mcp-<name>` | `mcp-postgres-query` |
| Service | `mcp-<name>` | `mcp-postgres-query` |
| ConfigMap | `mcp-<name>-config` | `mcp-postgres-query-config` |
| Secret | `mcp-<name>-secret` | `mcp-postgres-query-secret` |
| ServiceAccount | `mcp-<name>-sa` | `mcp-postgres-query-sa` |
| Route / Ingress | `mcp-<name>` | `mcp-postgres-query` |
| ImageStream (OCP) | `mcp-<name>` | `mcp-postgres-query` |

### Labels (all resources must include)
```yaml
labels:
  app: mcp-<name>
  app.kubernetes.io/name: mcp-<name>
  app.kubernetes.io/component: mcp-server
  app.kubernetes.io/part-of: mcp-platform
  app.kubernetes.io/version: "<semver>"
```

### TypeScript
- Entry point: `src/index.ts`
- Tool files: `src/tools/<tool-name>.ts` (one file per logical tool group)
- Resource files: `src/resources/<resource-name>.ts`
- Prompt files: `src/prompts/<prompt-name>.ts`
- Config: `src/config.ts` (reads from env vars only — no hardcoded values)

### Python
- Entry point: `src/main.py`
- Tools: `src/tools.py` or `src/tools/<tool_name>.py`
- Resources: `src/resources.py`
- Config: `src/config.py` (uses `os.environ` or `pydantic-settings`)
- Use `snake_case` for all Python identifiers

## Port Standards

| Purpose | Port | Notes |
|---|---|---|
| MCP HTTP server (default) | `8080` | Always use this unless there is a conflict |
| MCP HTTPS (direct TLS) | `8443` | Only for passthrough TLS scenarios |
| Health/metrics (separate) | `9090` | Optional Prometheus metrics endpoint |

- Container `EXPOSE` must match the port the app listens on
- Service `targetPort` must match container `EXPOSE`
- Never hardcode ports in application logic — always read from `PORT` env var with `8080` as default

```typescript
// TypeScript example
const PORT = parseInt(process.env.PORT ?? '8080', 10);
```
```python
# Python example
PORT = int(os.environ.get("PORT", "8080"))
```

## Environment Variable Patterns

### Naming Rules
- All uppercase, `SNAKE_CASE`
- Prefix with `MCP_` for MCP-specific config: `MCP_SERVER_NAME`, `MCP_LOG_LEVEL`
- No prefix for standard infra vars: `PORT`, `LOG_LEVEL`, `NODE_ENV`
- Secret values: never define defaults in code — fail fast if missing

### Standard Variables (every MCP server must support)
| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `MCP_SERVER_NAME` | (required) | Human-readable server name reported in MCP metadata |
| `MCP_SERVER_VERSION` | (required) | Semantic version string, e.g. `1.0.0` |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | `production` | Node.js environment (TypeScript only) |

### ConfigMap vs Secret split
- **ConfigMap**: non-sensitive config (`PORT`, `LOG_LEVEL`, `MCP_SERVER_NAME`, database hostnames, feature flags)
- **Secret**: credentials, tokens, connection strings with passwords, TLS certs
- Reference Secrets in Deployments via `secretKeyRef` — never mount secrets as files unless required by the library

```yaml
# ConfigMap reference example
envFrom:
  - configMapRef:
      name: mcp-<name>-config
# Secret reference example
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: mcp-<name>-secret
        key: db-password
```

## Dockerfile Conventions

- Always use **multi-stage builds** with named stages: `AS builder` and `AS runtime`
- Runtime base images (in order of preference): `node:22-alpine`, `python:3.12-slim`, `gcr.io/distroless/nodejs22-debian12`
- Set `WORKDIR /app` in both stages
- Final stage must set a non-root user: `USER 1001` (numeric UID preferred for OCP SCC compatibility)
- `EXPOSE` must match the `PORT` default (`8080`)
- `CMD` must be the direct process — no shell wrappers unless unavoidable

```dockerfile
# Required structure
FROM node:22-alpine AS builder
WORKDIR /app
# ... build steps

FROM node:22-alpine AS runtime
WORKDIR /app
USER 1001
EXPOSE 8080
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

## Health Endpoint Convention

Every MCP server must expose:
- `GET /health` → `200 OK`, body: `{ "status": "ok", "version": "<MCP_SERVER_VERSION>" }`

Kubernetes probes must reference this path:
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15
readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Security Conventions

- `runAsNonRoot: true` and `allowPrivilegeEscalation: false` in every container `securityContext`
- `readOnlyRootFilesystem: true` unless the framework requires write access (document the exception)
- Resource limits mandatory:
```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
```
- RBAC: create a dedicated `ServiceAccount` per MCP server — never use `default`

## Transport Convention

- Default transport for all containerized MCP servers: **Streamable HTTP** on path `/mcp`
- SSE transport: legacy only, use paths `/sse` (stream) and `/messages` (POST)
- `stdio` transport: local development and testing only — never deployed to K8s/OCP
