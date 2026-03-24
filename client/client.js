'use strict';

// --- Canvas setup ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let canvasSize = 0;

function resizeCanvas() {
  const size = Math.min(window.innerWidth - 20, window.innerHeight - 80);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasSize = size;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// --- HUD elements ---
const statusText = document.getElementById('status-text');
const infoText = document.getElementById('info-text');
const hpBar = document.getElementById('hp-bar');
const nicknameInput = document.getElementById('nickname-input');
const nicknameSetBtn = document.getElementById('nickname-set');
const nicknameError = document.getElementById('nickname-error');

// --- Tab elements ---
const tabGame = document.getElementById('tab-game');
const tabLeaderboard = document.getElementById('tab-leaderboard');
const gameView = document.getElementById('game-view');
const leaderboardView = document.getElementById('leaderboard-view');
const leaderboardBody = document.getElementById('leaderboard-body');
const leaderboardEmpty = document.getElementById('leaderboard-empty');
let activeTab = 'game';

// --- Game state ---
let ws = null;
let myId = null;
let gameState = null;
let arenaRadius = 500;

// --- Input state ---
const keys = { up: false, down: false, left: false, right: false };
let mouseX = canvasSize / 2;
let mouseY = canvasSize / 2;
let mouseDown = false;
let aimAngle = 0;

// --- Input handlers ---
window.addEventListener('keydown', (e) => {
  if (document.activeElement === nicknameInput) return;
  switch (e.key.toLowerCase()) {
    case 'w': keys.up = true; break;
    case 's': keys.down = true; break;
    case 'a': keys.left = true; break;
    case 'd': keys.right = true; break;
  }
});

window.addEventListener('keyup', (e) => {
  if (document.activeElement === nicknameInput) return;
  switch (e.key.toLowerCase()) {
    case 'w': keys.up = false; break;
    case 's': keys.down = false; break;
    case 'a': keys.left = false; break;
    case 'd': keys.right = false; break;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- WebSocket connection ---
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    statusText.textContent = 'Connected';
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'welcome') {
      myId = msg.playerId;
      arenaRadius = msg.arenaRadius;
    } else if (msg.type === 'state') {
      gameState = msg;
      updateHUD();
    } else if (msg.type === 'name_error') {
      nicknameError.textContent = msg.error;
      nicknameError.style.display = 'block';
    } else if (msg.type === 'name_ok') {
      nicknameError.style.display = 'none';
    } else if (msg.type === 'leaderboard') {
      renderLeaderboard(msg.data);
    }
  };

  ws.onclose = () => {
    statusText.textContent = 'Disconnected';
    infoText.textContent = 'Reconnecting...';
    gameState = null;
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

connect();

// --- Send input to server ---
function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !myId) return;

  // Calculate aim angle relative to the player's position on screen
  const me = gameState && gameState.players
    ? gameState.players.find((p) => p.id === myId)
    : null;

  if (me) {
    const scale = canvasSize / (arenaRadius * 2.2);
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const screenX = cx + me.x * scale;
    const screenY = cy + me.y * scale;
    aimAngle = Math.atan2(mouseY - screenY, mouseX - screenX);
  }

  ws.send(
    JSON.stringify({
      type: 'input',
      keys,
      angle: aimAngle,
      shoot: mouseDown,
    })
  );
}

setInterval(sendInput, 50); // 20 Hz input

// --- HUD update ---
function updateHUD() {
  if (!gameState) return;

  const me = gameState.players.find((p) => p.id === myId);
  const aliveCount = gameState.players.filter((p) => p.alive && !p.isSpectator).length;
  const totalCount = gameState.players.length;

  if (gameState.gameState === 'lobby') {
    if (gameState.lobbyCountdown !== null) {
      const secs = Math.ceil(gameState.lobbyCountdown / 1000);
      statusText.textContent = `Starting in ${secs}...`;
    } else {
      statusText.textContent = 'Waiting for players...';
    }
    infoText.textContent = `${totalCount} player${totalCount !== 1 ? 's' : ''} in lobby`;
  } else if (gameState.gameState === 'active') {
    if (gameState.isSpectator) {
      statusText.textContent = 'SPECTATING';
      infoText.textContent = `${aliveCount} alive — next round starts when match ends`;
    } else if (me && !me.alive) {
      statusText.textContent = 'ELIMINATED';
      infoText.textContent = `${aliveCount} remaining`;
    } else {
      statusText.textContent = `${aliveCount} alive`;
      infoText.textContent = '';
    }
  } else if (gameState.gameState === 'round_end') {
    if (gameState.winnerId === myId) {
      statusText.textContent = 'YOU WIN!';
    } else if (gameState.winnerId) {
      const winner = gameState.players.find((p) => p.id === gameState.winnerId);
      statusText.textContent = `${winner ? winner.name : 'Someone'} wins!`;
    } else {
      statusText.textContent = 'Draw!';
    }
    infoText.textContent = 'Next round starting soon...';
  }

  // Update HP bar
  if (me && !gameState.isSpectator) {
    const hpPct = Math.max(0, me.hp);
    hpBar.style.width = hpPct + '%';
    if (hpPct > 60) hpBar.style.background = '#4f4';
    else if (hpPct > 30) hpBar.style.background = '#ff4';
    else hpBar.style.background = '#f44';
  } else {
    hpBar.style.width = '0%';
  }
}

// --- Render loop ---
function render() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  if (!gameState) {
    ctx.fillStyle = '#666';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting...', canvasSize / 2, canvasSize / 2);
    requestAnimationFrame(render);
    return;
  }

  const scale = canvasSize / (arenaRadius * 2.2);
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  // Helper to trace a polygon path
  function tracePolygon(vertices) {
    if (!vertices || vertices.length < 3) return;
    ctx.moveTo(cx + vertices[0].x * scale, cy + vertices[0].y * scale);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(cx + vertices[i].x * scale, cy + vertices[i].y * scale);
    }
    ctx.closePath();
  }

  // Draw arena background (polygon)
  const arenaVerts = gameState.arenaVertices;
  const ringVerts = gameState.ringVertices;

  ctx.beginPath();
  tracePolygon(arenaVerts);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw danger zone (outside ring but inside arena) with red tint
  if (ringVerts && ringVerts.length >= 3) {
    ctx.save();
    ctx.beginPath();
    tracePolygon(arenaVerts);
    // Trace ring polygon in reverse for cutout
    for (let i = ringVerts.length - 1; i >= 0; i--) {
      if (i === ringVerts.length - 1) {
        ctx.moveTo(cx + ringVerts[i].x * scale, cy + ringVerts[i].y * scale);
      } else {
        ctx.lineTo(cx + ringVerts[i].x * scale, cy + ringVerts[i].y * scale);
      }
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
    ctx.fill();
    ctx.restore();

    // Draw ring boundary (safe zone outline)
    ctx.beginPath();
    tracePolygon(ringVerts);
    ctx.strokeStyle = '#f44';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Draw grid lines for visual reference
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.5;
  const gridStep = 100 * scale;
  for (let gx = cx % gridStep; gx < canvasSize; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, canvasSize);
    ctx.stroke();
  }
  for (let gy = cy % gridStep; gy < canvasSize; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(canvasSize, gy);
    ctx.stroke();
  }

  // Draw machine gun pickup
  if (gameState.machineGunPickup && !gameState.machineGunPickup.collected) {
    const pickup = gameState.machineGunPickup;
    const pkX = cx + pickup.x * scale;
    const pkY = cy + pickup.y * scale;
    const pkR = 12 * scale;

    // Outer glow
    ctx.beginPath();
    ctx.arc(pkX, pkY, pkR * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 165, 0, 0.15)';
    ctx.fill();

    // Background circle
    ctx.beginPath();
    ctx.arc(pkX, pkY, pkR, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1a00';
    ctx.strokeStyle = '#f80';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Machine gun icon: three horizontal barrel lines
    ctx.strokeStyle = '#f80';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const barrelLen = pkR * 0.7;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(pkX - barrelLen * 0.3, pkY + i * pkR * 0.25);
      ctx.lineTo(pkX + barrelLen, pkY + i * pkR * 0.25);
      ctx.stroke();
    }

    // Label
    const labelSize = Math.max(7, pkR * 0.4);
    ctx.font = `bold ${labelSize}px monospace`;
    ctx.fillStyle = '#f80';
    ctx.textAlign = 'center';
    ctx.fillText('MG', pkX, pkY + pkR + labelSize + 2);
  }

  // Draw bullets
  for (const bullet of gameState.bullets) {
    const bx = cx + bullet.x * scale;
    const by = cy + bullet.y * scale;
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff0';
    ctx.fill();
  }

  // Draw players (stick figures)
  for (const player of gameState.players) {
    if (player.isSpectator) continue;
    drawStickFigure(player, scale, cx, cy);
  }

  requestAnimationFrame(render);
}

function drawStickFigure(player, scale, cx, cy) {
  const px = cx + player.x * scale;
  const py = cy + player.y * scale;
  const r = 15 * scale;
  const isMe = player.id === myId;

  ctx.save();

  if (!player.alive) {
    ctx.globalAlpha = 0.3;
  }

  // Body color
  const isBot = player.isNPC;
  const color = isMe ? '#4fc' : isBot ? '#f80' : '#fff';
  const headColor = isMe ? '#4fc' : isBot ? '#f80' : '#fff';

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  // Head (circle)
  const headRadius = r * 0.4;
  ctx.beginPath();
  ctx.arc(px, py - r * 0.3, headRadius, 0, Math.PI * 2);
  ctx.strokeStyle = headColor;
  ctx.stroke();

  // Body (line from head down)
  ctx.beginPath();
  ctx.moveTo(px, py - r * 0.3 + headRadius);
  ctx.lineTo(px, py + r * 0.4);
  ctx.strokeStyle = color;
  ctx.stroke();

  // Legs (V shape)
  ctx.beginPath();
  ctx.moveTo(px - r * 0.35, py + r * 0.8);
  ctx.lineTo(px, py + r * 0.4);
  ctx.lineTo(px + r * 0.35, py + r * 0.8);
  ctx.stroke();

  // Arms / weapon (pointing toward aim angle)
  const armAngle = player.angle;
  const armLen = r * 0.6;
  const armOriginY = py;
  ctx.beginPath();
  ctx.moveTo(px, armOriginY);
  ctx.lineTo(px + Math.cos(armAngle) * armLen, armOriginY + Math.sin(armAngle) * armLen);
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Weapon tip (small dot)
  ctx.beginPath();
  ctx.arc(
    px + Math.cos(armAngle) * armLen,
    armOriginY + Math.sin(armAngle) * armLen,
    2,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = '#f80';
  ctx.fill();

  // HP bar above head
  if (player.alive) {
    const barWidth = r * 1.2;
    const barHeight = 3;
    const barY = py - r * 0.3 - headRadius - 6;
    ctx.fillStyle = '#333';
    ctx.fillRect(px - barWidth / 2, barY, barWidth, barHeight);
    const hpFrac = Math.max(0, player.hp / 100);
    ctx.fillStyle = hpFrac > 0.6 ? '#4f4' : hpFrac > 0.3 ? '#ff4' : '#f44';
    ctx.fillRect(px - barWidth / 2, barY, barWidth * hpFrac, barHeight);
  }

  // Name label
  const fontSize = Math.max(7, r * 0.25);
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = isMe ? '#4fc' : isBot ? '#f80' : '#aaa';
  ctx.textAlign = 'center';
  const displayName = isBot ? `[BOT] ${player.name}` : player.name;
  ctx.fillText(displayName, px, py + r * 0.8 + fontSize + 2);

  ctx.restore();
}

// --- Controls dialog ---
const controlsOverlay = document.getElementById('controls-overlay');
const controlsDismiss = document.getElementById('controls-dismiss');
const controlsHint = document.getElementById('controls-hint');

function dismissControls() {
  controlsOverlay.style.display = 'none';
}

function showControls() {
  controlsOverlay.style.display = 'flex';
}

controlsDismiss.addEventListener('click', dismissControls);
controlsOverlay.addEventListener('click', (e) => {
  if (e.target === controlsOverlay) dismissControls();
});
controlsHint.addEventListener('click', showControls);

window.addEventListener('keydown', (e) => {
  if (document.activeElement === nicknameInput) return;
  if (e.key.toLowerCase() === 'h') {
    if (controlsOverlay.style.display === 'none') {
      showControls();
    } else {
      dismissControls();
    }
  }
  if (e.key === 'Escape') {
    dismissControls();
  }
});

// --- Nickname submission ---
function submitNickname() {
  const name = nicknameInput.value.trim();
  if (!name || !ws || ws.readyState !== WebSocket.OPEN) return;
  nicknameError.style.display = 'none';
  ws.send(JSON.stringify({ type: 'set_name', name }));
  nicknameInput.blur();
}

nicknameSetBtn.addEventListener('click', submitNickname);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNickname();
});

// --- Tab navigation ---
function switchTab(tab) {
  activeTab = tab;
  if (tab === 'game') {
    gameView.style.display = 'flex';
    leaderboardView.style.display = 'none';
    tabGame.classList.add('active');
    tabLeaderboard.classList.remove('active');
  } else {
    gameView.style.display = 'none';
    leaderboardView.style.display = 'block';
    tabGame.classList.remove('active');
    tabLeaderboard.classList.add('active');
    fetchLeaderboard();
  }
}

tabGame.addEventListener('click', () => switchTab('game'));
tabLeaderboard.addEventListener('click', () => switchTab('leaderboard'));

// --- Leaderboard ---
function fetchLeaderboard() {
  fetch('/api/leaderboard')
    .then((res) => res.json())
    .then((data) => renderLeaderboard(data))
    .catch(() => {
      leaderboardBody.innerHTML = '';
      leaderboardEmpty.style.display = 'block';
    });
}

function renderLeaderboard(data) {
  leaderboardBody.innerHTML = '';
  if (!data || data.length === 0) {
    leaderboardEmpty.style.display = 'block';
    return;
  }
  leaderboardEmpty.style.display = 'none';
  for (const entry of data) {
    const tr = document.createElement('tr');
    const rankTd = document.createElement('td');
    rankTd.className = 'rank-col';
    rankTd.textContent = entry.rank;
    const nameTd = document.createElement('td');
    nameTd.textContent = entry.nickname;
    const winsTd = document.createElement('td');
    winsTd.className = 'wins-col';
    winsTd.textContent = entry.wins;
    tr.appendChild(rankTd);
    tr.appendChild(nameTd);
    tr.appendChild(winsTd);
    leaderboardBody.appendChild(tr);
  }
}

requestAnimationFrame(render);
