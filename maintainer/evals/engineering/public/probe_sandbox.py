"""Harmless confinement probes. No real credential or user file is read."""
import json
import os
from pathlib import Path
import socket


def denied(call):
    try:
        call()
        return False
    except OSError:
        return True


probe = Path("/testbed/.sandbox-probe")
probe.write_text("allowed")
allowed = probe.read_text() == "allowed"
probe.unlink()
result = {
    "workspace_write": allowed,
    "root_write_denied": denied(lambda: Path("/root-write-probe").write_text("x")),
    "coordinator_not_mounted": not Path("/coordinator").exists(),
    "docker_socket_not_mounted": not Path("/var/run/docker.sock").exists(),
    "host_mount_not_visible": not Path("/mnt/d").exists(),
    "provider_secret_not_in_environment": not any(k in os.environ for k in ("ZEO_API_KEY", "OPENAI_API_KEY", "OPENAI_API_KEY_ENV")),
    "external_network_denied": denied(lambda: socket.create_connection(("1.1.1.1", 443), timeout=2)),
    "inference_socket_present": Path("/inference/gateway.sock").is_socket(),
}
print(json.dumps(result))
raise SystemExit(0 if all(result.values()) else 1)
