import * as k8s from '@kubernetes/client-node';

/**
 * KubeConfig loaded via auto-detection:
 *  - In-cluster (pod running inside OCP): reads service account token and CA from mounted secrets
 *  - Local development: reads from KUBECONFIG env var or ~/.kube/config
 */
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

/** Core V1 API: pods, nodes, events, namespaces, services, PVs, PVCs, configmaps, secrets */
export const coreApi = kc.makeApiClient(k8s.CoreV1Api);

/** Apps V1 API: deployments, replicasets, statefulsets */
export const appsApi = kc.makeApiClient(k8s.AppsV1Api);

/** RBAC Authorization V1 API: roles, rolebindings, clusterroles, clusterrolebindings */
export const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);

/**
 * Custom Objects API: used for OpenShift-specific resources (Routes, Projects, Users,
 * Groups, MachineSets, Machines, MachineConfigs, etc.)
 */
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

/** Exported so tools can make raw node proxy requests (e.g. node journal logs) */
export { kc };
