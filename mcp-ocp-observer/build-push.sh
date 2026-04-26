#!/usr/bin/env bash
set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────
DEFAULT_REGISTRY="<your-registry-host>"
DEFAULT_ORG="<your-organization>"
DEFAULT_IMAGE="mcp-ocp-observer"
DEFAULT_TAG="v0.1.0"

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       MCP OCP Observer — Build & Push Script        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── Collect inputs ───────────────────────────────────────────────────────────
read -rp "Registry host       [${DEFAULT_REGISTRY}]: " REGISTRY
REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"

read -rp "Organization/project [${DEFAULT_ORG}]: " ORG
ORG="${ORG:-$DEFAULT_ORG}"

read -rp "Image name          [${DEFAULT_IMAGE}]: " IMAGE
IMAGE="${IMAGE:-$DEFAULT_IMAGE}"

read -rp "Version tag         [${DEFAULT_TAG}]: " TAG
TAG="${TAG:-$DEFAULT_TAG}"

read -rp "Registry username: " USERNAME

# Read password without echoing it to the terminal
read -rsp "Registry password: " PASSWORD
echo ""

# ─── Derived values ───────────────────────────────────────────────────────────
FULL_IMAGE="${REGISTRY}/${ORG}/${IMAGE}:${TAG}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Confirmation ─────────────────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────────────────┐"
echo "│ Build summary                                        │"
echo "├──────────────────────────────────────────────────────┤"
printf "│  Image  : %-43s│\n" "${FULL_IMAGE}"
printf "│  Context: %-43s│\n" "${SCRIPT_DIR}"
echo "└──────────────────────────────────────────────────────┘"
echo ""
read -rp "Proceed? (y/N): " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

# ─── Step 1: Login ────────────────────────────────────────────────────────────
echo ""
echo "[1/3] Logging in to ${REGISTRY} ..."
echo "${PASSWORD}" | podman login "${REGISTRY}" \
  --username "${USERNAME}" \
  --password-stdin

# Clear the password variable from memory as soon as it is no longer needed
PASSWORD=""

# ─── Step 2: Build ────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Building image: ${FULL_IMAGE} ..."
podman build \
  --no-cache \
  --tag "${FULL_IMAGE}" \
  --file "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}"

# ─── Step 3: Push ─────────────────────────────────────────────────────────────
echo ""
echo "[3/3] Pushing image: ${FULL_IMAGE} ..."
podman push "${FULL_IMAGE}"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "✓ Image successfully pushed: ${FULL_IMAGE}"
echo ""
echo "Next steps:"
echo "  1. Update ocp/deployment.yaml image field to: ${FULL_IMAGE}"
echo "  2. oc create secret generic mcp-ocp-observer-secret \\"
echo "         --from-literal=MCP_AUTH_TOKEN=\"\$(openssl rand -base64 48)\" \\"
echo "         -n validacao-infra"
echo "  3. oc apply -f ocp/ -n validacao-infra"
echo ""
