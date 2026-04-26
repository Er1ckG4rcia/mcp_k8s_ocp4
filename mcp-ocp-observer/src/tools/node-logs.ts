/// <reference types="node" />
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as https from 'https';
import * as fs from 'fs';
import { kc } from '../k8s-client.js';

// Paths to the in-cluster ServiceAccount credentials mounted by Kubernetes
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SA_CA_PATH    = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

// Schema defined at module level to prevent TS2589
const getNodeLogsSchema = {
  nodeName: z.string().describe('Name of the node to collect logs from'),
  unit: z.string().optional().describe(
    'Systemd unit to filter logs (e.g. kubelet, crio, NetworkManager, ovs-vswitchd). ' +
    'Omit to get general journal entries.'
  ),
  lines: z.number().int().min(1).max(500).optional().describe(
    'Number of log lines to return from the end. Default: 200. Max: 500. ' +
    'Keep this low to avoid exceeding context limits.'
  ),
  sinceTime: z.string().optional().describe(
    'Return logs since this time. Must use kubelet format: relative like "-24h", "-30m", "-2h" ' +
    '(negative = look back), or absolute "YYYY-MM-DD HH:MM:SS". ' +
    'Defaults to "-24h" (last 24 hours) when omitted.'
  ),
  logPath: z.enum(['journal', 'audit/audit.log', 'containers', 'pods']).optional().describe(
    'Log path to query. Default: journal (systemd). ' +
    'Use audit/audit.log for API audit events, containers/pods for kubelet-managed logs.'
  ),
};

const listNodeLogUnitsSchema = {
  nodeName: z.string().describe('Node name to list available systemd units for'),
};

/**
 * Build HTTPS request options using in-cluster SA credentials when available,
 * falling back to kubeconfig for local development.
 */
function buildRequestOptions(host: string, port: number, path: string): https.RequestOptions {
  if (fs.existsSync(SA_TOKEN_PATH) && fs.existsSync(SA_CA_PATH)) {
    // In-cluster: use the mounted service account token and CA cert directly.
    // This avoids kc.applyToHTTPSOptions() which can throw unhandled errors in-cluster.
    const token = fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim();
    const ca    = fs.readFileSync(SA_CA_PATH);
    return {
      hostname: host, port, path, method: 'GET', timeout: 240000,
      headers: { Authorization: `Bearer ${token}` },
      ca,
    };
  }
  // Local development fallback
  const cluster = kc.getCurrentCluster();
  return {
    hostname: host, port, path, method: 'GET', timeout: 240000,
    rejectUnauthorized: !cluster?.skipTLSVerify,
  };
}

// Maximum bytes kept in the rolling buffer while streaming.
// Older data is dropped as new chunks arrive — memory is always bounded.
const ROLLING_BUFFER_BYTES = 50_000;   // 50 KB in-flight max
// Hard abort: if the kubelet sends more than this, cut the connection.
// Prevents runaway responses even with the rolling buffer.
const STREAM_ABORT_BYTES   = 500_000;  // 500 KB absolute ceiling
// Characters sent to the LLM (taken from the tail of the rolling buffer).
const MAX_OUTPUT_CHARS     = 8_000;

/**
 * Fetch content from the Kubernetes node proxy log endpoint using a
 * rolling buffer so peak memory stays bounded regardless of response size.
 * The connection is aborted once STREAM_ABORT_BYTES are received.
 * Only the last MAX_OUTPUT_CHARS of the rolling buffer are returned.
 *
 * GET /api/v1/nodes/{node}/proxy/logs/{logPath}?unit=X&lines=N&since=...
 * Requires nodes/proxy ClusterRole permission.
 */
async function fetchNodeProxy(nodeName: string, logPath: string, params: URLSearchParams): Promise<string> {
  try {
    const cluster = kc.getCurrentCluster();
    if (!cluster) throw new Error('No current cluster in kubeconfig');

    const serverUrl  = new URL(cluster.server);
    const host       = serverUrl.hostname;
    const port       = Number(serverUrl.port) || 443;
    const query      = params.toString();
    const apiPath    = `/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/logs/${logPath}${query ? `?${query}` : ''}`;
    const options    = buildRequestOptions(host, port, apiPath);

    return await new Promise<string>((resolve, reject) => {
      let req: import('https').ClientRequest | undefined;
      try {
        req = https.request(options, (res) => {
          // Rolling window: keep only the latest ROLLING_BUFFER_BYTES of text.
          // String concatenation + slice is fast and avoids chunk-array growth.
          let rolling      = '';
          let totalBytes   = 0;
          let streamCapped = false;
          let statusCode   = res.statusCode ?? 0;

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;

            // Hard abort — stops the TCP stream to free the socket immediately.
            if (totalBytes >= STREAM_ABORT_BYTES && !streamCapped) {
              streamCapped = true;
              res.destroy();
              return;
            }

            rolling += chunk.toString('utf8');
            // Trim oldest data to keep the rolling buffer bounded.
            if (rolling.length > ROLLING_BUFFER_BYTES) {
              rolling = rolling.slice(rolling.length - ROLLING_BUFFER_BYTES);
            }
          });

          // 'close' fires on both normal end and res.destroy()
          res.on('close', () => {
            if (statusCode >= 400) {
              reject(new Error(`HTTP ${statusCode} from node proxy: ${rolling.slice(0, 400)}`));
              return;
            }

            if (!rolling) { resolve('(no output)'); return; }

            const tail   = rolling.slice(-MAX_OUTPUT_CHARS);
            const notice = streamCapped
              ? `[Response capped at ${STREAM_ABORT_BYTES / 1000} KB — showing tail only. ` +
                `Use a narrower unit= filter or shorter time window for full entries.]\n\n`
              : totalBytes > MAX_OUTPUT_CHARS
                ? `[Output truncated — showing last ${MAX_OUTPUT_CHARS} chars of ~${totalBytes} bytes received.]\n\n`
                : '';

            resolve(notice + tail);
          });

          res.on('error', (err) => {
            // Ignore errors triggered by our own res.destroy() call
            if (!streamCapped) reject(err);
          });
        });

        req.on('timeout', () => {
          req!.destroy(new Error('Node proxy request timed out after 240s — narrow with unit= or fewer lines'));
        });
        req.on('error', (err) => reject(err));
        req.end();
      } catch (syncErr) {
        reject(syncErr);
      }
    });
  } catch (err) {
    throw err;
  }
}

export function registerNodeLogTools(server: McpServer): void {
  // ─── get-node-logs ────────────────────────────────────────────────────────
  server.tool(
    'get-node-logs',
    'Retrieve systemd journal logs (or audit/container logs) directly from an OCP node ' +
    'via the kubelet proxy. Filter by systemd unit (kubelet, crio, NetworkManager, etc.). ' +
    'Essential for diagnosing node-level failures that do not appear in pod logs. ' +
    'Requires nodes/proxy ClusterRole permission. ' +
    'Always specify a unit and keep lines ≤ 500 to avoid timeouts.',
    getNodeLogsSchema,
    async ({ nodeName, unit, lines = 200, sinceTime = '-24h', logPath = 'journal' }) => {
      try {
        const params = new URLSearchParams();
        if (unit) params.set('unit', unit);
        params.set('lines', String(lines));
        params.set('since', sinceTime);

        const logs = await fetchNodeProxy(nodeName, logPath, params);
        return { content: [{ type: 'text', text: logs }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error getting node logs for ${nodeName}: ${msg}` }], isError: true };
      }
    }
  );

  // ─── list-node-log-units ──────────────────────────────────────────────────
  server.tool(
    'list-node-log-units',
    'List available systemd units on a node by querying the journal. ' +
    'Use this to discover which services are running (kubelet, crio, ovs-vswitchd, etc.) ' +
    'before calling get-node-logs with a specific unit filter.',
    listNodeLogUnitsSchema,
    async ({ nodeName }) => {
      try {
        // Request a small tail of the journal without unit filter to extract unit names
        const params = new URLSearchParams({ lines: '500' });
        const raw = await fetchNodeProxy(nodeName, 'journal', params);

        // Parse unique units from journal output lines
        const unitPattern = /(?:^|\s)(\S+\.(?:service|socket|target|mount|path|timer))/gm;
        const units = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = unitPattern.exec(raw)) !== null) {
          units.add(match[1]);
        }

        const result = units.size > 0
          ? Array.from(units).sort()
          : ['(could not extract unit names — try get-node-logs without a unit filter)'];

        return { content: [{ type: 'text', text: JSON.stringify({ node: nodeName, availableUnits: result }, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing node log units for ${nodeName}: ${msg}` }], isError: true };
      }
    }
  );
}
