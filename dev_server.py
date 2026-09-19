#!/usr/bin/env python3
"""
local development server for cs:go server finder.
serves static files and checks live players on servers via UDP A2S_INFO.
"""

import http.server
import json
import socketserver
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from server_finder import query_info

PORT = 3000

DEFAULT_SERVERS = [
    ("45.95.38.30", 27015),
    ("109.176.229.7", 27015),
    ("207.244.199.247", 26016),
    ("57.128.191.216", 27015),
    ("76.13.41.68", 27015),
    ("84.154.110.59", 27017),
    ("169.58.233.245", 27015),
    ("45.138.50.237", 27015),
    ("57.128.178.188", 27015),
    ("147.135.70.115", 27016),
    ("147.135.70.115", 27015),
    ("15.204.114.175", 27015),
    ("23.161.168.11", 27015),
]


def check_endpoint(endpoint: tuple[str, int]) -> dict:
    addr = f"{endpoint[0]}:{endpoint[1]}"
    res = query_info(endpoint, timeout=1.2)
    if res:
        return {
            "address": addr,
            "name": res.name,
            "map": res.map,
            "players": res.players,
            "maxPlayers": res.max_players,
            "ping": res.ping_ms,
            "online": True,
        }
    return {
        "address": addr,
        "online": False,
    }


def get_servers() -> list[tuple[str, int]]:
    try:
        with open("servers.json", "r", encoding="utf-8") as f:
            data = json.load(f)
            endpoints = []
            for item in data:
                addr = item if isinstance(item, str) else item.get("address", "")
                parts = addr.split(":")
                endpoints.append((parts[0].strip(), int(parts[1].strip())))
            if endpoints:
                return endpoints
    except Exception:
        pass
    return DEFAULT_SERVERS


class ServerHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/servers":
            try:
                server_list = get_servers()
                with ThreadPoolExecutor(max_workers=len(server_list) or 1) as pool:
                    results = list(pool.map(check_endpoint, server_list))

                payload = {
                    "timestamp": int(time.time() * 1000),
                    "servers": results,
                }
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'{"error":"internal server error"}')
        else:
            super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), ServerHandler) as httpd:
        print(f"serving at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
