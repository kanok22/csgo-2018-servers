#!/usr/bin/env python3
"""Find CS:GO servers running an exact game build. No Steam API key required."""

from __future__ import annotations

import argparse
import csv
import json
import os
import socket
import struct
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass


MASTER_HOST = "hl2master.steampowered.com"
MASTER_PORT = 27011
DEFAULT_BUILD = "1.36.2.9"
REGIONS = {
    "us-east": 0x00,
    "us-west": 0x01,
    "south-america": 0x02,
    "europe": 0x03,
    "asia": 0x04,
    "australia": 0x05,
    "middle-east": 0x06,
    "africa": 0x07,
    "world": 0xFF,
}


@dataclass(frozen=True)
class Server:
    ip: str
    port: int
    name: str
    map: str
    players: int
    max_players: int
    ping_ms: int
    version: str
    password: bool
    vac: bool

    @property
    def address(self) -> str:
        return f"{self.ip}:{self.port}"


def read_cstring(data: bytes, offset: int) -> tuple[str, int]:
    end = data.find(b"\x00", offset)
    if end < 0:
        raise ValueError("unterminated string in A2S response")
    return data[offset:end].decode("utf-8", "replace"), end + 1


def parse_master_reply(data: bytes) -> tuple[list[tuple[str, int]], bool]:
    if not data.startswith(b"\xff\xff\xff\xfff\n"):
        raise ValueError("invalid Steam master-server reply")
    servers: list[tuple[str, int]] = []
    finished = False
    for offset in range(6, len(data) - 5, 6):
        ip = socket.inet_ntoa(data[offset : offset + 4])
        port = struct.unpack_from(">H", data, offset + 4)[0]
        if ip == "0.0.0.0" and port == 0:
            finished = True
            break
        servers.append((ip, port))
    return servers, finished


def discover(build: str, region: int, maximum: int, timeout: float) -> list[tuple[str, int]]:
    # 0x31 = A2M_GET_SERVERS_BATCH2. App 730 is Counter-Strike: Global Offensive.
    filter_text = f"\\appid\\730\\version_match\\{build}"
    prefix = bytes((0x31, region))
    suffix = b"\x00" + filter_text.encode("ascii") + b"\x00"
    cursor = "0.0.0.0:0"
    found: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()

    addresses = socket.getaddrinfo(MASTER_HOST, MASTER_PORT, socket.AF_INET, socket.SOCK_DGRAM)
    if not addresses:
        raise RuntimeError("could not resolve Steam master server")

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        master = addresses[0][4]
        while len(found) < maximum:
            sock.sendto(prefix + cursor.encode("ascii") + suffix, master)
            try:
                data, _ = sock.recvfrom(65535)
            except socket.timeout:
                # The legacy master server is rate-limited; keep results already received.
                break
            batch, finished = parse_master_reply(data)
            if not batch:
                break
            for endpoint in batch:
                if endpoint not in seen:
                    seen.add(endpoint)
                    found.append(endpoint)
                    if len(found) >= maximum:
                        break
            cursor = f"{batch[-1][0]}:{batch[-1][1]}"
            if finished:
                break
    return found


def discover_web_api(api_key: str, build: str, region: int, maximum: int, timeout: float) -> list[tuple[str, int]]:
    filter_text = f"\\appid\\730\\version_match\\{build}"
    if region != 0xFF:
        filter_text += f"\\region\\{region}"
    query = urllib.parse.urlencode({"key": api_key, "filter": filter_text, "limit": min(maximum, 50000)})
    url = "https://api.steampowered.com/IGameServersService/GetServerList/v1/?" + query
    with urllib.request.urlopen(url, timeout=max(5.0, timeout)) as response:
        payload = json.load(response)
    endpoints: list[tuple[str, int]] = []
    for server in payload.get("response", {}).get("servers", []):
        address = server.get("addr", "")
        try:
            ip, port = address.rsplit(":", 1)
            endpoints.append((ip, int(port)))
        except (ValueError, TypeError):
            continue
    return endpoints


def parse_a2s_info(data: bytes, ip: str, port: int, ping_ms: int) -> Server:
    if len(data) < 6 or data[:4] != b"\xff\xff\xff\xff" or data[4] != 0x49:
        raise ValueError("not a Source A2S_INFO response")
    offset = 6  # header, response type, protocol byte
    name, offset = read_cstring(data, offset)
    map_name, offset = read_cstring(data, offset)
    _folder, offset = read_cstring(data, offset)
    _game, offset = read_cstring(data, offset)
    fixed_size = struct.calcsize("<HBBBccBB")
    if offset + fixed_size > len(data):
        raise ValueError("short A2S_INFO response")
    _appid, players, max_players, _bots, _server_type, _environment, visibility, vac = struct.unpack_from(
        "<HBBBccBB", data, offset
    )
    offset += fixed_size
    version, offset = read_cstring(data, offset)
    game_port = port
    if offset < len(data):
        edf = data[offset]
        offset += 1
        if edf & 0x80 and offset + 2 <= len(data):
            game_port = struct.unpack_from("<H", data, offset)[0]
    return Server(ip, game_port, name, map_name, players, max_players, ping_ms, version, bool(visibility), bool(vac))


def query_info(endpoint: tuple[str, int], timeout: float) -> Server | None:
    ip, port = endpoint
    request = b"\xff\xff\xff\xffTSource Engine Query\x00"
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        started = time.perf_counter()
        sock.sendto(request, endpoint)
        try:
            data, _ = sock.recvfrom(65535)
            # Some servers require a challenge appended to A2S_INFO.
            if len(data) >= 9 and data[:5] == b"\xff\xff\xff\xffA":
                sock.sendto(request + data[5:9], endpoint)
                data, _ = sock.recvfrom(65535)
        except (socket.timeout, OSError):
            return None
    try:
        return parse_a2s_info(data, ip, port, round((time.perf_counter() - started) * 1000))
    except (ValueError, struct.error):
        return None


def print_results(servers: list[Server]) -> None:
    if not servers:
        print("No responsive servers with that exact build were found.")
        return
    servers.sort(key=lambda server: (server.ping_ms, server.name.casefold()))
    print(f"\nFound {len(servers)} matching server(s):\n")
    for server in servers:
        lock = " password" if server.password else ""
        print(
            f"{server.address:<22} {server.ping_ms:>4} ms  "
            f"{server.players:>2}/{server.max_players:<2}  {server.map:<18} {server.name}{lock}"
        )
        print(f"  connect {server.address}")


def write_csv(path: str, servers: list[Server]) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as output:
        writer = csv.writer(output)
        writer.writerow(("address", "name", "map", "players", "max_players", "ping_ms", "version", "password", "vac"))
        for s in servers:
            writer.writerow((s.address, s.name, s.map, s.players, s.max_players, s.ping_ms, s.version, s.password, s.vac))


def write_txt(path: str, servers: list[Server], build: str) -> None:
    ordered = sorted(servers, key=lambda server: (server.ping_ms, server.name.casefold()))
    rule = "=" * 76
    with open(path, "w", encoding="utf-8", newline="\n") as output:
        output.write(f"{rule}\n")
        output.write("CS:GO SERVER FINDER\n")
        output.write(f"Exact build: {build}    Matches: {len(ordered)}\n")
        output.write(f"{rule}\n")
        for number, server in enumerate(ordered, 1):
            access = "Password required" if server.password else "Public"
            output.write(f"\n[{number:02}] {server.name}\n")
            output.write(f"     Address : {server.address}\n")
            output.write(f"     Connect : connect {server.address}\n")
            output.write(f"     Map     : {server.map}\n")
            output.write(f"     Players : {server.players}/{server.max_players}\n")
            output.write(f"     Ping    : {server.ping_ms} ms\n")
            output.write(f"     Access  : {access}\n")
            output.write(f"     VAC     : {'Enabled' if server.vac else 'Disabled'}\n")
        output.write(f"\n{rule}\n")


def main() -> int:
    # Windows may default to cp1252, while Steam server names are UTF-8.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Find CS:GO servers running an exact build")
    parser.add_argument("--build", default=DEFAULT_BUILD, help=f"exact server build (default: {DEFAULT_BUILD})")
    parser.add_argument("--region", choices=REGIONS, default="world")
    parser.add_argument("--max", type=int, default=5000, dest="maximum", help="maximum candidates (default: 5000)")
    parser.add_argument("--workers", type=int, default=100, help="parallel info queries (default: 100)")
    parser.add_argument("--timeout", type=float, default=1.5, help="UDP timeout in seconds (default: 1.5)")
    parser.add_argument("--api-key", default=os.getenv("STEAM_API_KEY"), help="Steam Web API key (or set STEAM_API_KEY)")
    parser.add_argument("--csv", metavar="FILE", help="also save matches to a CSV file")
    parser.add_argument("--txt", metavar="FILE", help="also save a nicely formatted text report")
    args = parser.parse_args()
    if args.maximum < 1 or args.workers < 1 or args.timeout <= 0:
        parser.error("--max, --workers and --timeout must be positive")

    print(f"Asking Steam for CS:GO build {args.build} servers ({args.region})...")
    try:
        candidates = discover(args.build, REGIONS[args.region], args.maximum, args.timeout)
    except (OSError, ValueError, RuntimeError) as error:
        if not args.api_key:
            print(f"Keyless discovery failed: {error}", file=sys.stderr)
            print("Valve's legacy master service may be unavailable. Re-run with --api-key YOUR_STEAM_WEB_API_KEY.", file=sys.stderr)
            return 1
        print(f"Keyless discovery failed ({error}); trying the Steam Web API...")
        try:
            candidates = discover_web_api(args.api_key, args.build, REGIONS[args.region], args.maximum, args.timeout)
        except Exception as api_error:
            print(f"Steam Web API discovery failed: {api_error}", file=sys.stderr)
            return 1
    print(f"Steam returned {len(candidates)} candidate(s); verifying exact versions...")

    matches: list[Server] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=min(args.workers, len(candidates) or 1)) as pool:
        futures = [pool.submit(query_info, endpoint, args.timeout) for endpoint in candidates]
        try:
            for future in as_completed(futures):
                completed += 1
                server = future.result()
                if server is not None and server.version == args.build:
                    matches.append(server)
                    print(f"  MATCH  {server.address}  {server.name}")
                if completed % 250 == 0:
                    print(f"  checked {completed}/{len(candidates)}...")
        except KeyboardInterrupt:
            print("\nStopped early; showing matches found so far.")
            for future in futures:
                future.cancel()

    print_results(matches)
    if args.csv:
        write_csv(args.csv, matches)
        print(f"\nSaved {len(matches)} match(es) to {args.csv}")
    if args.txt:
        write_txt(args.txt, matches, args.build)
        print(f"Saved formatted report to {args.txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
