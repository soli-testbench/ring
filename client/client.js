'use strict';

// --- Canvas setup ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const size = Math.min(window.innerWidth - 20, window.innerHeight - 80);
  canvas.width = size;
  canvas.height = size;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// --- HUD elements ---
const statusText = document.getElementById('status-text');
const infoText = document.getElementById('info-text');
const hpBar = document.getElementById('hp-bar');

// --- Game state ---
let ws = null;
let myId = null;
let gameState = null;
let arenaRadius = 500;

// --- Input state ---
const keys = { up: false, down: false, left: false, right: false };
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;
let mouseDown = false;
let aimAngle = 0;

// --- Input handlers ---
window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case 'w': keys.up = true; break;
    case 's': keys.down = true; break;
    case 'a': keys.left = true; break;
    case 'd': keys.right = true; break;
  }
});

window.addEventListener('keyup', (e) => {
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
    const scale = canvas.width / (arenaRadius * 2.2);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
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
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!gameState) {
    ctx.fillStyle = '#666';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting...', canvas.width / 2, canvas.height / 2);
    requestAnimationFrame(render);
    return;
  }

  const scale = canvas.width / (arenaRadius * 2.2);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Draw arena background (dark circle)
  ctx.beginPath();
  ctx.arc(cx, cy, arenaRadius * scale, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw ring (safe zone)
  ctx.beginPath();
  ctx.arc(cx, cy, gameState.ringRadius * scale, 0, Math.PI * 2);
  ctx.strokeStyle = '#f44';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Draw danger zone (outside ring but inside arena) with red tint
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, arenaRadius * scale, 0, Math.PI * 2);
  ctx.arc(cx, cy, gameState.ringRadius * scale, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
  ctx.fill();
  ctx.restore();

  // Draw grid lines for visual reference
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.5;
  const gridStep = 100 * scale;
  for (let gx = cx % gridStep; gx < canvas.width; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, canvas.height);
    ctx.stroke();
  }
  for (let gy = cy % gridStep; gy < canvas.height; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(canvas.width, gy);
    ctx.stroke();
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
  const color = isMe ? '#4fc' : '#fff';
  const headColor = isMe ? '#4fc' : '#fff';

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
  ctx.font = `${Math.max(10, r * 0.5)}px monospace`;
  ctx.fillStyle = isMe ? '#4fc' : '#aaa';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, px, py + r * 1.1);

  ctx.restore();
}

requestAnimationFrame(render);
