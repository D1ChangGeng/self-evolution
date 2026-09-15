import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
import socket
import sys

sys.path.insert(0, str(Path(__file__).parent))
from provider_gateway import Gateway, Handler


class GatewayBoundaryTests(unittest.TestCase):
    def setUp(self):
        if not hasattr(socket, "AF_UNIX"):
            self.skipTest("Unix-socket gateway requires Linux")
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "gateway.sock")
        try:
            self.server = Gateway(self.path, Handler)
        except OSError:
            self.temp.cleanup()
            self.skipTest("Unix sockets unavailable on this platform")
        self.server.model = "gpt-5.6-terra"
        self.server.key = "unused-test-placeholder"
        self.server.url = "https://example.invalid/v1"
        self.server.output = Path(self.temp.name)
        self.server.max_requests = 1
        self.server.requests = 0
        self.server.input_tokens = 0
        self.server.output_tokens = 0
        self.server.deadline = float("inf")
        self.server.lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if hasattr(self, "server"):
            self.server.shutdown()
            self.server.server_close()
            self.temp.cleanup()

    def post(self, route, data):
        body = json.dumps(data).encode()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(self.path)
            client.sendall((f"POST {route} HTTP/1.0\r\nContent-Length: {len(body)}\r\n\r\n").encode() + body)
            data = b""
            while part := client.recv(4096):
                data += part
            return data.split(b"\r\n")[0]

    @patch("provider_gateway.urllib.request.urlopen")
    def test_other_routes_models_and_hosted_network_tools_do_not_reach_upstream(self, upstream):
        self.assertIn(b"403", self.post("/v1/files", {"model": "gpt-5.6-terra"}))
        self.assertIn(b"400", self.post("/v1/responses", {"model": "another-model"}))
        self.assertIn(b"400", self.post("/v1/responses", {"model": "gpt-5.6-terra", "tools": [{"type": "web_search"}]}))
        upstream.assert_not_called()

    @patch("provider_gateway.urllib.request.urlopen")
    def test_exhausted_budget_prevents_further_inference(self, upstream):
        self.server.requests = 1
        self.assertIn(b"429", self.post("/v1/responses", {"model": "gpt-5.6-terra", "reasoning": {"effort": "medium"}}))
        upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
