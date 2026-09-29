"""Local dev server with caching disabled. Usage: python serve.py [port]"""
import http.server
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    print(f"Local:   http://localhost:{PORT}")
    print(f"Phone:   http://{lan_ip()}:{PORT}  (same Wi-Fi)", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCache).serve_forever()
