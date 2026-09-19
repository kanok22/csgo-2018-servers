// Vercel serverless function to check live players on CS:GO servers via UDP A2S_INFO
import dgram from 'dgram';

const DEFAULT_SERVERS = [
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

const ALLOWED_SERVERS = new Set(DEFAULT_SERVERS);

function queryServer(addr, timeout = 1200) {
  return new Promise((resolve) => {
    // Strict allowlist check (eliminates SSRF)
    if (!ALLOWED_SERVERS.has(addr)) {
      return resolve({ address: addr, online: false });
    }

    const parts = addr.split(':');
    const ip = parts[0];
    const port = parseInt(parts[1], 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      return resolve({ address: addr, online: false });
    }

    let client = null;
    let timer = null;
    let finished = false;
    const start = Date.now();

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (client) {
        try {
          client.removeAllListeners();
          client.close();
        } catch (e) {}
        client = null;
      }
    };

    try {
      client = dgram.createSocket('udp4');
    } catch (e) {
      return resolve({ address: addr, online: false });
    }

    // Handle socket errors to prevent unhandled process crashes
    client.on('error', () => {
      cleanup();
      resolve({ address: addr, online: false });
    });

    const req = Buffer.concat([
      Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]),
      Buffer.from('TSource Engine Query\0')
    ]);

    timer = setTimeout(() => {
      cleanup();
      resolve({ address: addr, online: false });
    }, timeout);

    client.on('message', (msg) => {
      // Challenge response
      if (msg.length >= 9 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF && msg[4] === 0x41) {
        const challenge = msg.subarray(5, 9);
        if (client && !finished) {
          try {
            client.send(Buffer.concat([req, challenge]), port, ip);
          } catch (e) {
            cleanup();
            resolve({ address: addr, online: false });
          }
        }
        return;
      }

      // A2S_INFO response
      if (msg.length >= 5 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF && msg[4] === 0x49) {
        const ping = Date.now() - start;
        let offset = 6;

        const readCString = () => {
          if (offset >= msg.length) return '';
          const end = msg.indexOf(0x00, offset);
          if (end === -1) {
            throw new Error('unterminated cstring');
          }
          const str = msg.subarray(offset, end).toString('utf8');
          offset = end + 1;
          return str;
        };

        try {
          const name = readCString();
          const map = readCString();
          readCString(); // folder
          readCString(); // game
          if (offset + 4 > msg.length) throw new Error('packet truncated');
          offset += 2; // appid
          const players = msg.readUInt8(offset++);
          const maxPlayers = msg.readUInt8(offset++);

          cleanup();
          resolve({
            address: addr,
            name: name || 'CS:GO Server',
            map: map || 'unknown',
            players,
            maxPlayers,
            ping,
            online: true
          });
        } catch (e) {
          cleanup();
          resolve({ address: addr, online: false });
        }
      }
    });

    try {
      client.send(req, port, ip, (err) => {
        if (err) {
          cleanup();
          resolve({ address: addr, online: false });
        }
      });
    } catch (e) {
      cleanup();
      resolve({ address: addr, online: false });
    }
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5, stale-while-revalidate=10');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Strictly enforce that only allowed servers can be queried (eliminates SSRF & DoS amplification)
  let serverList = DEFAULT_SERVERS;
  if (req.query && typeof req.query.servers === 'string') {
    const requested = req.query.servers.split(',').map(s => s.trim()).filter(Boolean);
    const filtered = requested.filter(s => ALLOWED_SERVERS.has(s));
    if (filtered.length > 0) {
      serverList = filtered.slice(0, 15);
    }
  }

  try {
    const results = await Promise.all(serverList.map((addr) => queryServer(addr)));
    return res.status(200).json({
      timestamp: Date.now(),
      servers: results
    });
  } catch (error) {
    return res.status(500).json({ error: 'failed to query servers' });
  }
}
