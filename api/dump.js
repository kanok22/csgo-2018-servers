// Vercel serverless function to dump connected CS:GO players (Name - SteamID)
import dgram from 'dgram';

const GIST_SERVERS_URL = 'https://gist.githubusercontent.com/kanok22/ba7c6e99ef241f958e12306128246e1b/raw/servers.json';
const STEAM_KEY = '7B6CBEB987800E5D0C64B19902CC72DA';

const DEFAULT_SERVERS = [
  '151.244.72.225:27015',
  '45.95.38.30:27015',
  '109.176.229.7:27015',
  '207.244.199.247:26016',
  '57.128.191.216:27015',
  '76.13.41.68:27015',
  '84.154.110.59:27017',
  '169.58.233.245:27015',
  '45.138.50.237:27015',
  '57.128.178.188:27015',
  '147.135.70.115:27016',
  '147.135.70.115:27015',
  '15.204.114.175:27015',
  '23.161.168.11:27015'
];

const IP_PORT_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):([0-9]{1,5})$/;

function isSafePublicServer(addr) {
  if (typeof addr !== 'string') return false;
  const match = addr.trim().match(IP_PORT_REGEX);
  if (!match) return false;
  const port = parseInt(match[1], 10);
  if (port < 1024 || port > 65535) return false;

  const ip = addr.split(':')[0];
  const parts = ip.split('.').map(Number);
  if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 169 && parts[1] === 254) return false;
  if (parts[0] >= 224) return false;

  return true;
}

async function getLiveServerList() {
  const baseSourceUrl = process.env.SERVERS_URL || GIST_SERVERS_URL;
  const sep = baseSourceUrl.includes('?') ? '&' : '?';
  const sourceUrl = `${baseSourceUrl}${sep}t=${Date.now()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      let rawList = [];
      if (Array.isArray(data)) {
        rawList = data.map(item => {
          if (typeof item === 'string') return { address: item.trim(), customName: null };
          if (item && typeof item === 'object') {
            const addr = String(item.address || item.ip || '').trim();
            const customName = item.name ? String(item.name).trim() : null;
            return { address: addr, customName };
          }
          return null;
        }).filter(Boolean);
      }
      const sanitized = rawList.filter(item => isSafePublicServer(item.address));
      if (sanitized.length > 0) return sanitized;
    }
  } catch (e) {}

  return DEFAULT_SERVERS.map(addr => ({ address: addr, customName: null }));
}

function queryServerPlayers(target, timeout = 950) {
  const addr = typeof target === 'string' ? target : target.address;
  const customName = (typeof target === 'object' && target.customName) ? target.customName : null;

  return new Promise((resolve) => {
    if (!isSafePublicServer(addr)) {
      return resolve({ address: addr, name: customName || 'CS:GO Server', online: false, players: [] });
    }

    const [ip, portStr] = addr.split(':');
    const port = parseInt(portStr, 10);

    let client = null;
    let timer = null;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (client) {
        try { client.removeAllListeners(); client.close(); } catch (e) {}
        client = null;
      }
    };

    try {
      client = dgram.createSocket('udp4');
    } catch (e) {
      return resolve({ address: addr, name: customName || 'CS:GO Server', online: false, players: [] });
    }

    timer = setTimeout(() => {
      cleanup();
      resolve({ address: addr, name: customName || 'CS:GO Server', online: false, players: [] });
    }, timeout);

    client.on('error', () => {
      cleanup();
      resolve({ address: addr, name: customName || 'CS:GO Server', online: false, players: [] });
    });

    // Step 1: Send A2S_INFO to get map and server name
    const infoReq = Buffer.concat([
      Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]),
      Buffer.from('TSource Engine Query\0')
    ]);

    let serverName = customName || 'CS:GO Server';
    let mapName = 'unknown';

    client.on('message', (msg) => {
      // Challenge response (for A2S_INFO or A2S_PLAYER)
      if (msg.length >= 9 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF && msg[4] === 0x41) {
        const challenge = msg.subarray(5, 9);
        if (client && !finished) {
          try {
            // Send A2S_PLAYER with challenge
            const playerReq = Buffer.concat([Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55]), challenge]);
            client.send(playerReq, port, ip);
          } catch (e) {}
        }
        return;
      }

      // A2S_INFO response (0x49 = 'I')
      if (msg.length >= 5 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF && msg[4] === 0x49) {
        try {
          let offset = 6;
          const readCString = () => {
            const end = msg.indexOf(0x00, offset);
            if (end === -1) throw new Error('end');
            const s = msg.subarray(offset, end).toString('utf8');
            offset = end + 1;
            return s;
          };
          const liveName = readCString();
          mapName = readCString();
          if (!customName) serverName = liveName;

          // Request A2S_PLAYER
          const playerInitReq = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF]);
          if (client && !finished) {
            client.send(playerInitReq, port, ip);
          }
        } catch (e) {
          // fallback send player req directly
          const playerInitReq = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF]);
          if (client && !finished) client.send(playerInitReq, port, ip);
        }
        return;
      }

      // A2S_PLAYER response (0x44 = 'D')
      if (msg.length >= 5 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF && msg[4] === 0x44) {
        try {
          let offset = 5;
          const numPlayers = msg.readUInt8(offset++);
          const players = [];

          while (offset < msg.length) {
            msg.readUInt8(offset++); // index
            const nullIdx = msg.indexOf(0x00, offset);
            if (nullIdx === -1) break;
            const pName = msg.subarray(offset, nullIdx).toString('utf8').trim();
            offset = nullIdx + 1;
            if (offset + 8 > msg.length) break;
            const score = msg.readInt32LE(offset);
            offset += 4;
            const duration = msg.readFloatLE(offset);
            offset += 4;

            if (pName && pName.length > 0) {
              players.push({
                name: pName,
                score,
                durationSeconds: Math.floor(duration)
              });
            }
          }

          cleanup();
          resolve({
            address: addr,
            name: serverName,
            map: mapName,
            online: true,
            players
          });
        } catch (e) {
          cleanup();
          resolve({ address: addr, name: serverName, map: mapName, online: true, players: [] });
        }
      }
    });

    try {
      client.send(infoReq, port, ip);
    } catch (e) {
      cleanup();
      resolve({ address: addr, name: customName || 'CS:GO Server', online: false, players: [] });
    }
  });
}

function steam64ToSteam2(steam64) {
  try {
    const id = BigInt(steam64);
    const base = BigInt('76561197960265728');
    if (id < base) return null;
    const diff = id - base;
    const y = diff % 2n;
    const z = diff / 2n;
    return `STEAM_0:${y}:${z}`;
  } catch (e) {
    return null;
  }
}

const steamIdCache = new Map();
let cachedGlobalDump = null;
let cachedGlobalDumpTime = 0;
const DUMP_CACHE_TTL_MS = 4000;

async function resolveSteamId(playerName) {
  // If player name looks like a 17-digit Steam64
  if (/^7656119[0-9]{10}$/.test(playerName)) {
    const s2 = steam64ToSteam2(playerName);
    return `${playerName}${s2 ? ` [${s2}]` : ''}`;
  }

  // If player name looks like a STEAM_0:X:Y format
  if (/^STEAM_[01]:[01]:[0-9]+$/i.test(playerName)) {
    return playerName;
  }

  const clean = playerName.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!clean || clean.length < 2) {
    return '[hidden by server]';
  }

  if (steamIdCache.has(clean)) {
    return steamIdCache.get(clean);
  }

  let result = '[hidden by server]';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 950);
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(clean)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.response && data.response.success === 1 && data.response.steamid) {
        const s64 = data.response.steamid;
        const s2 = steam64ToSteam2(s64);
        result = `${s64}${s2 ? ` [${s2}]` : ''}`;
      }
    }
  } catch (e) {}

  steamIdCache.set(clean, result);
  return result;
}

function formatDuration(sec) {
  if (!sec || sec < 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetAddr = req.query.addr ? String(req.query.addr).trim() : null;

  // Serve fast from cache if global dump was requested recently
  if (!targetAddr && req.query.format !== 'json' && cachedGlobalDump && (Date.now() - cachedGlobalDumpTime < DUMP_CACHE_TTL_MS)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="players_dump_${cachedGlobalDumpTime}.txt"`);
    return res.status(200).send(cachedGlobalDump);
  }

  try {
    const serverList = await getLiveServerList();

    let targets = serverList;
    if (targetAddr) {
      const match = serverList.find(s => (s.address || s) === targetAddr);
      targets = match ? [match] : [{ address: targetAddr, customName: null }];
    }

    const serverResults = await Promise.all(targets.map(t => queryServerPlayers(t)));

    // Collect and resolve players concurrently
    const allPlayersFlat = [];
    const resolveTasks = [];

    for (const s of serverResults) {
      if (s.online && Array.isArray(s.players)) {
        for (const p of s.players) {
          resolveTasks.push((async () => {
            const steamid = await resolveSteamId(p.name);
            p.steamid = steamid;
            allPlayersFlat.push({
              name: p.name,
              steamid,
              score: p.score,
              duration: formatDuration(p.durationSeconds),
              serverName: s.name,
              serverAddress: s.address,
              serverMap: s.map
            });
          })());
        }
      }
    }

    if (resolveTasks.length > 0) {
      await Promise.all(resolveTasks);
    }

    if (req.query.format === 'json') {
      return res.status(200).json({
        timestamp: Date.now(),
        totalPlayers: allPlayersFlat.length,
        servers: serverResults,
        players: allPlayersFlat
      });
    }

    // Generate minimal formatted TXT file
    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const lines = [];

    lines.push(`generated: ${nowIso}`);
    lines.push('discord:   discord.gg/familyhook\n');

    if (targetAddr) {
      // Single server dump
      const targetServer = serverResults[0];
      if (targetServer && targetServer.online && Array.isArray(targetServer.players) && targetServer.players.length > 0) {
        targetServer.players.forEach(p => {
          lines.push(`${p.name} - ${p.steamid}`);
        });
      } else {
        lines.push('[no players online]');
      }
    } else {
      // All servers dump
      const onlineWithPlayers = serverResults.filter(s => s.online && Array.isArray(s.players) && s.players.length > 0);

      if (onlineWithPlayers.length === 0) {
        lines.push('[no players online]');
      } else if (onlineWithPlayers.length === 1) {
        const s = onlineWithPlayers[0];
        lines.push(`[${s.name}]`);
        s.players.forEach(p => {
          lines.push(`${p.name} - ${p.steamid}`);
        });
      } else {
        onlineWithPlayers.forEach(s => {
          lines.push(`[${s.name}]`);
          s.players.forEach(p => {
            lines.push(`${p.name} - ${p.steamid}`);
          });
          lines.push('');
        });

        lines.push('[all players]');
        const sortedFlat = [...allPlayersFlat].sort((a, b) => a.name.localeCompare(b.name));
        sortedFlat.forEach(p => {
          lines.push(`${p.name} - ${p.steamid}`);
        });
      }
    }

    const txtOutput = lines.join('\n') + '\n';
    const filename = targetAddr
      ? `players_${targetAddr.replace(/[^a-zA-Z0-9]/g, '_')}.txt`
      : `players_dump_${Date.now()}.txt`;

    if (!targetAddr && req.query.format !== 'json') {
      cachedGlobalDump = txtOutput;
      cachedGlobalDumpTime = Date.now();
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(txtOutput);
  } catch (error) {
    return res.status(500).send(`Error generating players dump: ${error.message || error}`);
  }
}
