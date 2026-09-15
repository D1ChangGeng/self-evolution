"""A task-scoped Responses gateway. Provider credentials stay in the coordinator."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import socketserver
import socket
import struct
import threading
import time
import urllib.error
import urllib.request


class Gateway(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_error(405)

    def do_POST(self):
        server = self.server
        if hasattr(socket, "SO_PEERCRED"):
            _, uid, _ = struct.unpack("3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                self.send_error(403)
                return
        if self.path != "/v1/responses":
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8 * 1024 * 1024:
                raise ValueError("request size")
            body = self.rfile.read(size)
            data = json.loads(body)
            if data.get("model") != server.model or data.get("reasoning", {}).get("effort") != "medium":
                raise ValueError("model differs from fixed campaign model")
            if data.get("max_output_tokens", 0) > 16000 or any(t.get("type") not in ("function", "custom") for t in data.get("tools", [])):
                raise ValueError("network-capable hosted tool")
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_error(400, "Request outside fixed inference contract")
            return
        with server.lock:
            if server.requests >= server.max_requests or time.monotonic() > server.deadline or server.input_tokens >= 500000 or server.output_tokens >= 16000:
                self.send_error(429, "Attempt request/time budget exhausted")
                return
            number = server.requests
            server.requests += 1
        # Input here contains benchmark task material, never provider credentials.
        (server.output / f"request-{number:03d}.json").write_bytes(body)
        receipt = {"sequence": number, "model": data["model"], "request_sha256": hashlib.sha256(body).hexdigest(),
                   "started_at": time.time()}
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + server.key}
        data["max_output_tokens"] = min(16000 - server.output_tokens, 8192)
        forwarded = json.dumps(data).encode()
        (server.output / f"forwarded-{number:03d}.json").write_bytes(forwarded)
        request = urllib.request.Request(server.url.rstrip("/") + "/responses", data=forwarded, headers=headers, method="POST")
        result = None
        try:
            result = urllib.request.urlopen(request, timeout=120)
            receipt["status"] = result.status
            self.send_response(result.status)
            self.send_header("Content-Type", result.headers.get("Content-Type", "text/event-stream"))
            self.send_header("Connection", "close")
            self.end_headers()
            with (server.output / f"response-{number:03d}.sse").open("wb") as trace:
                while chunk := result.read1(65536):
                    trace.write(chunk)
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as error:
            receipt["status"] = error.code
            # Error payload can include upstream configuration; retain only status.
            self.send_error(error.code, "Upstream model request failed")
        except (OSError, TimeoutError):
            receipt["status"] = "transport-error"
            self.close_connection = True
        finally:
            if result:
                result.close()
            response_path = server.output / f"response-{number:03d}.sse"
            if response_path.exists():
                for line in response_path.read_text(errors="replace").splitlines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        event = json.loads(line[6:])
                        usage = event.get("response", {}).get("usage")
                        if event.get("type") == "response.completed" and isinstance(usage, dict):
                            receipt["usage"] = usage
                            with server.lock:
                                server.input_tokens += usage.get("input_tokens", 0)
                                server.output_tokens += usage.get("output_tokens", 0)
                    except (ValueError, TypeError):
                        continue
            receipt["finished_at"] = time.time()
            (server.output / f"receipt-{number:03d}.json").write_text(json.dumps(receipt, indent=2) + "\n")


def serve(socket, output, url, key, max_requests=64, timeout_seconds=900):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    with Gateway(str(socket), Handler) as server:
        server.model = "gpt-5.6-terra"
        server.key = key
        server.url = url
        server.output = output
        server.max_requests = max_requests
        server.requests = 0
        server.input_tokens = 0
        server.output_tokens = 0
        server.deadline = time.monotonic() + timeout_seconds
        server.lock = threading.Lock()
        os.chmod(socket, 0o600)  # The socket is mounted only into the matching task container.
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    serve(args.socket, args.output, config["base_url"], os.environ[config["env_key"]])
