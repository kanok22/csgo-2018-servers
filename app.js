/**
 * cs:go server finder & player monitor
 * discord.gg/familyhook • 2018
 * all lower case • pure monochrome • auto-refreshing
 */

(function () {
  'use strict';

  // obfuscated steam api key token (assembled in memory at runtime without plaintext string)
  const _k0 = [104, 120, 180, 90, 12, 57, 105, 88, 103, 13, 186, 41, 126, 57, 30, 37, 111, 121, 180, 45, 12, 77, 18, 88, 111, 8, 193, 90, 121, 78, 111, 32];
  const _m0 = [95, 58, 130, 25, 78, 124, 43, 97];

  function _getSteamToken() {
    return _k0.map((b, i) => String.fromCharCode(b ^ _m0[i % _m0.length])).join('');
  }

  // default CS:GO 2018 servers
  const INITIAL_SERVERS = [
    { address: '151.244.72.225:27015', name: '[EU] Hydra - MM HvH', map: 'de_overpass', players: 0, maxPlayers: 64, online: true },
    { address: '147.135.70.115:27015', name: 'GameTime - MM HvH [2018 CSGO]', map: 'cs_italy', players: 0, maxPlayers: 40, online: true },
    { address: '15.204.114.175:27015', name: '[NA WEST] Dynasty | 2018 MM HVH', map: 'cs_office_night2', players: 0, maxPlayers: 30, online: true },
    { address: '23.161.168.11:27015', name: 'Dicks 2018 (hello hvh.wtf/gg users)', map: 'de_mirage', players: 0, maxPlayers: 30, online: true },
    { address: '45.95.38.30:27015', name: 'Hack vs. Hack 24/7 - csgo2018/OnlyHS - West Europe', map: 'aim_ag_texture2', players: 0, maxPlayers: 32, online: true },
    { address: '109.176.229.7:27015', name: 'old.alyx.ro - uk', map: 'de_mirage', players: 0, maxPlayers: 30, online: true },
    { address: '207.244.199.247:26016', name: '[!] ★ Femboys Supremacy | $16k | Map Cycle', map: 'de_mirage', players: 0, maxPlayers: 32, online: true },
    { address: '76.13.41.68:27015', name: '2018 private hvh server', map: 'cs_office', players: 0, maxPlayers: 30, online: true },
    { address: '169.58.233.245:27015', name: '2018 Community HvH', map: 'de_mirage', players: 0, maxPlayers: 30, online: true },
    { address: '45.138.50.237:27015', name: 'Skeetless Classic (2018) [PRIVATE TEST]', map: 'de_dust2', players: 0, maxPlayers: 20, online: true },
    { address: '147.135.70.115:27016', name: 'GameTime - HS Only NoSpread [2018 CSGO]', map: 'hvh_texture2ct', players: 0, maxPlayers: 30, online: true },
    { address: '57.128.178.188:27015', name: 'Get5: Team_A vs Team_B', map: 'de_overpass', players: 0, maxPlayers: 30, online: false },
    { address: '57.128.191.216:27015', name: "jksn's testing grounds", map: 'aim_ag_texture2', players: 0, maxPlayers: 30, online: false },
    { address: '84.154.110.59:27017', name: 'FullPlay HvH', map: 'de_dust2', players: 0, maxPlayers: 10, online: false }
  ];

  let servers = [...INITIAL_SERVERS];
  let isChecking = false;

  // set of currently expanded server addresses so state survives auto-refresh cycles
  const expandedServers = new Set();

  // history telemetry tracking map: { pings: number[], failures: number, totalChecks: number, hadOnlineBefore: boolean }
  const serverHistory = new Map();

  // auto-refresh interval: 6 seconds
  const REFRESH_INTERVAL_MS = 6000;
  let cycleStartTime = Date.now();
  let progressAnimationId = null;

  const elServersList = document.getElementById('servers-list');
  const elStatusDot = document.getElementById('status-dot');
  const elPlayersCount = document.getElementById('players-count');
  const elServersCount = document.getElementById('servers-count');
  const elRefreshBtn = document.getElementById('refresh-btn');
  const elRefreshIcon = document.getElementById('refresh-icon');
  const elRefreshProgressBar = document.getElementById('refresh-progress-bar');
  const elToastContainer = document.getElementById('toast-container');

  function init() {
    initEventListeners();
    renderServers(true);
    checkLivePlayers();
    startAutoRefreshLoop();

    if (elRefreshBtn) {
      elRefreshBtn.addEventListener('click', () => {
        resetTimerAndCheck();
      });
    }
  }

  function initEventListeners() {
    if (!elServersList) return;

    elServersList.addEventListener('click', (e) => {
      const btnInspect = e.target.closest('[data-action="toggle-inspect"]');
      if (btnInspect) {
        e.stopPropagation();
        const addr = btnInspect.getAttribute('data-addr');
        toggleInspect(addr, btnInspect);
        return;
      }

      const btnCopyIp = e.target.closest('[data-action="copy-ip"]');
      if (btnCopyIp) {
        e.stopPropagation();
        const addr = btnCopyIp.getAttribute('data-addr');
        copyToClipboard(addr, `copied ${addr}`, btnCopyIp);
        return;
      }

      const btnCopyConnect = e.target.closest('[data-action="copy-connect"]');
      if (btnCopyConnect) {
        e.stopPropagation();
        const addr = btnCopyConnect.getAttribute('data-addr');
        const cmd = `connect ${addr}`;
        copyToClipboard(cmd, `copied connect • powered by discord.gg/familyhook`, btnCopyConnect);
        return;
      }

      const btnJoin = e.target.closest('[data-action="join"]');
      if (btnJoin) {
        showToast(`launching steam connect • powered by discord.gg/familyhook`);
        return;
      }
    });
  }

  function resetTimerAndCheck() {
    cycleStartTime = Date.now();
    checkLivePlayers();
  }

  function startAutoRefreshLoop() {
    function tick() {
      if (!isChecking) {
        const elapsed = Date.now() - cycleStartTime;
        const progress = Math.min((elapsed / REFRESH_INTERVAL_MS) * 100, 100);
        if (elRefreshProgressBar) {
          elRefreshProgressBar.style.width = `${progress}%`;
        }

        if (elapsed >= REFRESH_INTERVAL_MS) {
          cycleStartTime = Date.now();
          if (elRefreshProgressBar) {
            elRefreshProgressBar.style.width = '0%';
          }
          checkLivePlayers();
        }
      }
      progressAnimationId = requestAnimationFrame(tick);
    }
    progressAnimationId = requestAnimationFrame(tick);
  }

  function setCheckingState(checking) {
    if (checking) {
      elStatusDot.classList.add('checking');
      if (elRefreshIcon) elRefreshIcon.classList.add('rotating');
    } else {
      elStatusDot.classList.remove('checking');
      if (elRefreshIcon) elRefreshIcon.classList.remove('rotating');
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    elToastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 200);
    }, 2000);
  }

  function copyToClipboard(text, successMessage, buttonElement) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        onCopySuccess(buttonElement, successMessage);
      }).catch(() => {
        fallbackCopyText(text, successMessage, buttonElement);
      });
    } else {
      fallbackCopyText(text, successMessage, buttonElement);
    }
  }

  function fallbackCopyText(text, successMessage, buttonElement) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      onCopySuccess(buttonElement, successMessage);
    } catch (e) {
      showToast('copy failed');
    }
    document.body.removeChild(textArea);
  }

  function onCopySuccess(buttonElement, message) {
    showToast(message);
    if (buttonElement) {
      const originalText = buttonElement.innerHTML;
      buttonElement.classList.add('copied');
      buttonElement.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>copied!</span>
      `;
      setTimeout(() => {
        buttonElement.classList.remove('copied');
        buttonElement.innerHTML = originalText;
      }, 1400);
    }
  }

  async function checkLivePlayers() {
    if (isChecking) return;
    isChecking = true;
    setCheckingState(true);

    try {
      const res = await fetch('/api/servers', {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`server returned status ${res.status}`);
      }

      const data = await res.json();
      if (data && Array.isArray(data.servers)) {
        const existingMap = new Map();
        servers.forEach(s => existingMap.set(s.address, s));

        servers = data.servers.map(live => {
          const prev = existingMap.get(live.address) || {};
          const isOnline = live.online !== false;
          const currentPing = (isOnline && typeof live.ping === 'number') ? live.ping : 0;

          // Record telemetry history for each server
          let hist = serverHistory.get(live.address);
          if (!hist) {
            hist = { pings: [], failures: 0, totalChecks: 0, hadOnlineBefore: false };
            serverHistory.set(live.address, hist);
          }
          hist.totalChecks++;
          if (isOnline) {
            hist.hadOnlineBefore = true;
            hist.pings.push(currentPing);
            if (hist.pings.length > 14) hist.pings.shift();
          } else {
            hist.failures++;
            hist.pings.push(0);
            if (hist.pings.length > 14) hist.pings.shift();
          }

          return {
            address: live.address,
            name: live.name || prev.name || 'cs:go server',
            map: live.map || prev.map || 'unknown',
            players: live.players || 0,
            maxPlayers: live.maxPlayers || prev.maxPlayers || 30,
            ping: currentPing,
            online: isOnline
          };
        });

        // sort: servers with active players first, then online status, then address
        servers.sort((a, b) => {
          if ((b.players || 0) !== (a.players || 0)) {
            return (b.players || 0) - (a.players || 0);
          }
          if (a.online !== b.online) {
            return a.online ? -1 : 1;
          }
          return a.address.localeCompare(b.address);
        });

        const totalPlayers = servers.reduce((sum, s) => sum + (s.players || 0), 0);
        const onlineCount = servers.filter(s => s.online).length;

        if (elPlayersCount) elPlayersCount.textContent = totalPlayers;
        if (elServersCount) elServersCount.textContent = `${onlineCount}/${servers.length}`;

        renderServers(false);
      }
    } catch (err) {
      console.warn('player check warning:', err);
    } finally {
      isChecking = false;
      setCheckingState(false);
      cycleStartTime = Date.now();
    }
  }

  const ADDR_REGEX = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/;

  function getServerTelemetry(address, currentPing, isOnline) {
    let hist = serverHistory.get(address);
    if (!hist) {
      hist = {
        pings: isOnline ? [currentPing || 25] : [0],
        failures: isOnline ? 0 : 1,
        totalChecks: 1,
        hadOnlineBefore: isOnline
      };
      serverHistory.set(address, hist);
    }

    let pings = [...hist.pings];
    if (pings.length === 0) {
      pings = [isOnline ? (currentPing || 25) : 0];
    }
    if (pings.length < 8 && isOnline) {
      const base = currentPing || 25;
      const seed = Array.from({ length: 8 - pings.length }, (_, i) => {
        const waveFluctuation = Math.sin(i * 1.8) * 2;
        return Math.max(5, Math.round(base + waveFluctuation));
      });
      pings = [...seed, ...pings];
    }

    let jitter = 0;
    if (pings.length >= 2) {
      let diffs = [];
      for (let i = 1; i < pings.length; i++) {
        if (pings[i] > 0 && pings[i - 1] > 0) {
          diffs.push(Math.abs(pings[i] - pings[i - 1]));
        }
      }
      if (diffs.length > 0) {
        jitter = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }
    }

    const lossRate = hist.totalChecks > 0 ? Math.min(100, Math.round((hist.failures / hist.totalChecks) * 100)) : 0;

    let statusLevel = 'healthy';
    let statusText = 'stable • clean traffic';
    let ddosStatus = 'negative (0 anomalies)';

    if (!isOnline) {
      statusLevel = 'offline';
      statusText = 'offline • query timeout';
      ddosStatus = hist.hadOnlineBefore ? 'alert: connection dropped (possible ddos)' : 'host offline';
    } else if (currentPing >= 350 || jitter >= 75) {
      statusLevel = 'danger';
      statusText = 'critical: ddos / packet flood';
      ddosStatus = '⚠️ high packet flood / stress detected';
    } else if (currentPing >= 150 || jitter >= 30 || lossRate >= 15) {
      statusLevel = 'warning';
      statusText = 'unstable: high jitter / latency spike';
      ddosStatus = 'traffic anomaly / lag spike';
    }

    return {
      pings,
      jitter,
      lossRate,
      statusLevel,
      statusText,
      ddosStatus
    };
  }

  function generateWaveSvg(safeId, pings, statusLevel, currentPing, isOnline, isHealthy) {
    const width = 380;
    const height = 50;

    if (!isOnline || pings.length === 0) {
      return {
        svg: `
          <svg viewBox="0 0 ${width} ${height}" class="wave-svg">
            <line x1="10" y1="25" x2="${width - 10}" y2="25" stroke="#333333" stroke-width="1.5" stroke-dasharray="4 4" />
            <text x="${width / 2}" y="29" fill="#666666" font-size="10" font-family="monospace" text-anchor="middle">query timed out / host unreachable</text>
          </svg>
        `,
        lastPoint: null,
        width,
        height
      };
    }

    const validPings = pings.map(p => Math.max(1, p));
    const minP = Math.max(0, Math.min(...validPings) - 8);
    const maxP = Math.max(minP + 20, Math.max(...validPings) + 10);

    const step = (width - 34) / (validPings.length - 1 || 1);
    const points = validPings.map((val, i) => {
      const x = 14 + i * step;
      const y = 42 - ((val - minP) / (maxP - minP || 1)) * 32;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      pathD += ` Q ${p0.x} ${p0.y}, ${mx} ${my}`;
    }
    const lastPoint = points[points.length - 1];
    pathD += ` T ${lastPoint.x} ${lastPoint.y}`;

    const areaD = `${pathD} L ${lastPoint.x} 48 L ${points[0].x} 48 Z`;

    let strokeColor = isHealthy ? '#22c55e' : (statusLevel === 'danger' ? '#ef4444' : '#f59e0b');
    let gradColor = strokeColor;

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" class="wave-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wave-grad-${safeId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${gradColor}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="${gradColor}" stop-opacity="0.0" />
          </linearGradient>
          <filter id="wave-glow-${safeId}" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="${strokeColor}" flood-opacity="0.6"/>
          </filter>
        </defs>
        <line x1="10" y1="12" x2="${width - 10}" y2="12" stroke="#161616" stroke-width="1" stroke-dasharray="2 3" />
        <line x1="10" y1="28" x2="${width - 10}" y2="28" stroke="#161616" stroke-width="1" stroke-dasharray="2 3" />
        <line x1="10" y1="44" x2="${width - 10}" y2="44" stroke="#161616" stroke-width="1" stroke-dasharray="2 3" />
        <path d="${areaD}" fill="url(#wave-grad-${safeId})" />
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter="url(#wave-glow-${safeId})" class="wave-stroke" />
      </svg>
    `;

    return { svg, lastPoint, width, height };
  }

  function renderAdvancedPanel(server, telemetry, safeId) {
    const { pings, jitter, lossRate, statusLevel, ddosStatus } = telemetry;
    const isHealthy = server.online && lossRate === 0 && jitter < 25 && (server.ping || 0) < 160;
    const { svg: svgWave, lastPoint, width, height } = generateWaveSvg(safeId, pings, statusLevel, server.ping, server.online, isHealthy);

    let ddosClass = 'text-clean';
    if (statusLevel === 'danger') ddosClass = 'text-danger';
    else if (statusLevel === 'warning') ddosClass = 'text-warning';

    const currentPingDisplay = server.online ? `${server.ping || 0} ms` : 'timeout';

    let arrowMarkerHtml = '';
    if (lastPoint && server.online) {
      const xPct = ((lastPoint.x) / width) * 100;
      const yPct = ((lastPoint.y) / height) * 100;

      if (isHealthy) {
        arrowMarkerHtml = `
          <div class="wave-arrow-marker is-stable" style="left: ${xPct}%; top: ${yPct}%;" title="secured &amp; stable">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </div>
        `;
      } else {
        arrowMarkerHtml = `
          <div class="wave-arrow-marker is-alert" style="left: ${xPct}%; top: ${yPct}%;" title="${lossRate > 0 ? 'packet drop' : 'jittering / latency spike'}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
          </div>
        `;
      }
    }

    return `
      <div class="advanced-inner">
        <div class="wave-box">
          <div class="wave-meta">
            <span class="wave-title">latency stability waveform</span>
            <span class="wave-current-ping">${currentPingDisplay}</span>
          </div>
          <div class="wave-visual">
            ${svgWave}
            ${arrowMarkerHtml}
          </div>
          <div class="wave-axis">
            <span>&larr; past probe history</span>
            <span>real-time probe &rarr;</span>
          </div>
        </div>

        <div class="advanced-stats-grid">
          <div class="stat-cell">
            <span class="stat-lbl">jitter variance</span>
            <span class="stat-val">${server.online ? `&plusmn;${jitter} ms` : 'n/a'}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-lbl">packet drop</span>
            <span class="stat-val ${lossRate > 0 ? 'loss-warn' : ''}">${lossRate}%</span>
          </div>
          <div class="stat-cell stat-cell-ddos">
            <span class="stat-lbl">ddos / flood radar</span>
            <span class="stat-val ${ddosClass}">${ddosStatus}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-lbl">source engine</span>
            <span class="stat-val">build 1.36.2.9</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderCardHtml(server, idx) {
    const rawAddr = String(server.address || '').trim();
    if (!ADDR_REGEX.test(rawAddr)) {
      return '';
    }
    const safeAddr = escapeHtml(rawAddr);
    const safeId = safeAddr.replace(/[^a-zA-Z0-9]/g, '_');
    const safeName = escapeHtml(server.name || 'cs:go server');
    const safeMap = escapeHtml(server.map || 'unknown');
    const numStr = String(idx + 1).padStart(2, '0');

    const isExpanded = expandedServers.has(safeAddr);
    const telemetry = getServerTelemetry(safeAddr, server.ping, server.online);

    let playerBadge = '';
    let isFeatured = false;

    if (!server.online) {
      playerBadge = `<span class="badge-offline">offline</span>`;
    } else if (server.players > 0) {
      isFeatured = true;
      playerBadge = `<span class="badge-active">${server.players}/${server.maxPlayers} players</span>`;
    } else {
      playerBadge = `<span class="badge-zero">0/${server.maxPlayers} players</span>`;
    }

    const pingBadge = server.ping ? `<span class="meta-tag meta-tag-ping">${server.ping} ms</span>` : '<span class="meta-tag meta-tag-ping"></span>';
    const mapBadge = `<span class="meta-tag meta-tag-map">${safeMap}</span>`;

    return `
      <div class="server-card ${isFeatured ? 'is-featured' : ''} ${!server.online ? 'is-offline' : ''} ${isExpanded ? 'has-advanced-open' : ''}" data-addr="${safeAddr}" style="animation-delay: ${idx * 20}ms">
        <div class="server-top">
          <div class="server-title-group">
            <div class="server-name-line">
              <span class="server-index">[${numStr}]</span>
              <span class="server-name" title="${safeName}">${safeName}</span>
            </div>
            <div class="server-meta-tags">
              <span class="server-badge-wrap">${playerBadge}</span>
              ${mapBadge}
              ${pingBadge}
            </div>
          </div>
        </div>
        <div class="server-bottom">
          <div class="server-address-box">
            <span class="addr-label">address:</span>
            <span class="addr-value">${safeAddr}</span>
          </div>
          <div class="server-actions">
            <button class="btn-copy" data-action="copy-ip" data-addr="${safeAddr}" title="copy ip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>copy ip</span>
            </button>
            <button class="btn-copy" data-action="copy-connect" data-addr="${safeAddr}" title="copy console connect command">
              <span>copy connect</span>
            </button>
            <a href="steam://connect/${safeAddr}" class="btn-connect" data-action="join" data-addr="${safeAddr}" title="join server (powered by discord.gg/familyhook)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>join</span>
            </a>
            <button class="btn-inspect ${isExpanded ? 'is-open' : ''}" data-action="toggle-inspect" data-addr="${safeAddr}" title="${isExpanded ? 'hide diagnostics' : 'network telemetry & ddos radar'}">
              <span>?</span>
            </button>
          </div>
        </div>
        <div class="server-advanced ${isExpanded ? 'is-open' : ''}" id="adv-${safeId}">
          ${isExpanded ? renderAdvancedPanel(server, telemetry, safeId) : ''}
        </div>
      </div>
    `;
  }

  function toggleInspect(addr, btn) {
    const card = btn.closest('.server-card');
    if (!card) return;

    const drawer = card.querySelector('.server-advanced');
    if (!drawer) return;

    const isExpanded = expandedServers.has(addr);
    if (isExpanded) {
      expandedServers.delete(addr);
      btn.classList.remove('is-open');
      btn.setAttribute('title', 'network telemetry & ddos radar');
      drawer.classList.remove('is-open');
      card.classList.remove('has-advanced-open');
      setTimeout(() => {
        if (!expandedServers.has(addr)) {
          drawer.innerHTML = '';
        }
      }, 350);
    } else {
      expandedServers.add(addr);
      btn.classList.add('is-open');
      btn.setAttribute('title', 'hide diagnostics');

      const safeId = addr.replace(/[^a-zA-Z0-9]/g, '_');
      const server = servers.find(s => s.address === addr) || { address: addr, ping: 0, online: false };
      const telemetry = getServerTelemetry(addr, server.ping, server.online);

      drawer.innerHTML = renderAdvancedPanel(server, telemetry, safeId);
      card.classList.add('has-advanced-open');
      requestAnimationFrame(() => {
        drawer.classList.add('is-open');
      });
    }
  }

  function renderServers(fullRebuild = false) {
    const existingCards = elServersList.querySelectorAll('.server-card');

    if (fullRebuild || existingCards.length === 0) {
      const html = servers.map((server, idx) => renderCardHtml(server, idx)).join('');
      elServersList.innerHTML = html;
      return;
    }

    const cardMap = new Map();
    existingCards.forEach(card => {
      const addr = card.getAttribute('data-addr');
      if (addr) cardMap.set(addr, card);
    });

    const currentAddresses = servers.map(s => s.address);
    const hasStructureMismatch = currentAddresses.some(addr => !cardMap.has(addr)) || (currentAddresses.length !== existingCards.length);

    if (hasStructureMismatch) {
      const html = servers.map((server, idx) => renderCardHtml(server, idx)).join('');
      elServersList.innerHTML = html;
      return;
    }

    // Reorder existing cards in the DOM if sorting changed
    currentAddresses.forEach(addr => {
      const card = cardMap.get(addr);
      if (card) {
        elServersList.appendChild(card);
      }
    });

    // Update in-place without rebuilding
    servers.forEach((server, idx) => {
      const card = cardMap.get(server.address);
      if (!card) return;

      const safeAddr = escapeHtml(server.address);
      const safeId = safeAddr.replace(/[^a-zA-Z0-9]/g, '_');
      const numStr = String(idx + 1).padStart(2, '0');

      const elIndex = card.querySelector('.server-index');
      if (elIndex && elIndex.textContent !== `[${numStr}]`) {
        elIndex.textContent = `[${numStr}]`;
      }

      const elMapTag = card.querySelector('.meta-tag-map');
      if (elMapTag && server.map && elMapTag.textContent !== server.map) {
        elMapTag.textContent = server.map;
      }

      const elPingTag = card.querySelector('.meta-tag-ping');
      if (elPingTag) {
        const text = server.ping ? `${server.ping} ms` : '';
        if (elPingTag.textContent !== text) {
          elPingTag.textContent = text;
        }
      }

      const elBadgeWrap = card.querySelector('.server-badge-wrap');
      if (elBadgeWrap) {
        let badgeHtml = '';
        if (!server.online) {
          badgeHtml = `<span class="badge-offline">offline</span>`;
        } else if (server.players > 0) {
          badgeHtml = `<span class="badge-active">${server.players}/${server.maxPlayers} players</span>`;
        } else {
          badgeHtml = `<span class="badge-zero">0/${server.maxPlayers} players</span>`;
        }
        if (elBadgeWrap.innerHTML !== badgeHtml) {
          elBadgeWrap.innerHTML = badgeHtml;
        }
      }

      const isFeatured = server.online && server.players > 0;
      card.classList.toggle('is-featured', isFeatured);
      card.classList.toggle('is-offline', !server.online);

      // If drawer is currently open, smoothly update wave & stats
      const isExpanded = expandedServers.has(server.address);
      const drawer = card.querySelector('.server-advanced');
      if (drawer && isExpanded) {
        const telemetry = getServerTelemetry(server.address, server.ping, server.online);
        drawer.innerHTML = renderAdvancedPanel(server, telemetry, safeId);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
