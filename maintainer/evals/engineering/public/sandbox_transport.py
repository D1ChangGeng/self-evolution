"""Bridge container loopback HTTP to the one mounted inference Unix socket."""
import argparse
import socket
import socketserver


class Bridge(socketserver.BaseRequestHandler):
    def handle(self):
        import select
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as upstream:
            upstream.connect(self.server.gateway_socket)
            peers = [self.request, upstream]
            while True:
                ready, _, _ = select.select(peers, [], [], 180)
                if not ready:
                    return
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is self.request else self.request).sendall(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="/inference/gateway.sock")
    parser.add_argument("--port", type=int, default=18080)
    args = parser.parse_args()
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), Bridge) as server:
        server.daemon_threads = True
        server.gateway_socket = args.socket
        server.serve_forever()
