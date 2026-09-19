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

  // default 13 CS:GO 2018 servers
  const INITIAL_SERVERS = [
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
    renderServers();
    checkLivePlayers();
    startAutoRefreshLoop();

    if (elRefreshBtn) {
      elRefreshBtn.addEventListener('click', () => {
        resetTimerAndCheck();
      });
    }
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
        const liveMap = new Map();
        data.servers.forEach(s => liveMap.set(s.address, s));

        servers = servers.map(server => {
          const live = liveMap.get(server.address);
          if (live) {
            return {
              ...server,
              name: live.name || server.name,
              map: live.map || server.map,
              players: live.players || 0,
              maxPlayers: live.maxPlayers || server.maxPlayers,
              ping: live.ping || server.ping,
              online: live.online !== false
            };
          }
          return server;
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

        renderServers();
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

  function renderServers() {
    const html = servers.map((server, idx) => {
      const rawAddr = String(server.address || '').trim();
      if (!ADDR_REGEX.test(rawAddr)) {
        return '';
      }
      const safeAddr = escapeHtml(rawAddr);
      const safeName = escapeHtml(server.name || 'cs:go server');
      const safeMap = escapeHtml(server.map || 'unknown');
      const numStr = String(idx + 1).padStart(2, '0');

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

      const pingBadge = server.ping ? `<span class="meta-tag">${server.ping} ms</span>` : '';
      const mapBadge = `<span class="meta-tag">${safeMap}</span>`;

      return `
        <div class="server-card ${isFeatured ? 'is-featured' : ''} ${!server.online ? 'is-offline' : ''}" style="animation-delay: ${idx * 20}ms">
          <div class="server-top">
            <div class="server-title-group">
              <div class="server-name-line">
                <span class="server-index">[${numStr}]</span>
                <span class="server-name" title="${safeName}">${safeName}</span>
              </div>
              <div class="server-meta-tags">
                ${playerBadge}
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
            </div>
          </div>
        </div>
      `;
    }).join('');

    elServersList.innerHTML = html;

    // bind copy & join actions
    elServersList.querySelectorAll('[data-action="copy-ip"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = btn.getAttribute('data-addr');
        copyToClipboard(addr, `copied ${addr}`, btn);
      });
    });

    elServersList.querySelectorAll('[data-action="copy-connect"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const addr = btn.getAttribute('data-addr');
        const cmd = `connect ${addr}`;
        copyToClipboard(cmd, `copied connect • powered by discord.gg/familyhook`, btn);
      });
    });

    elServersList.querySelectorAll('[data-action="join"]').forEach(btn => {
      btn.addEventListener('click', () => {
        showToast(`launching steam connect • powered by discord.gg/familyhook`);
      });
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
