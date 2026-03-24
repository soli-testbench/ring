'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = process.env.PORT || 8080;

// --- Static file serving ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const clientDir = path.join(__dirname, '..', 'client');

function serveStatic(req, res) {
  // API endpoints
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    const data = game.getLeaderboard();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;

  // Prevent directory traversal
  const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(clientDir, safePath);

  if (!fullPath.startsWith(clientDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// --- HTTP Server ---
const server = http.createServer(serveStatic);

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });
const game = new Game();

// Map ws connections to player IDs
const wsToPlayer = new Map();

game.onBroadcast = () => {
  for (const [ws, playerId] of wsToPlayer) {
    if (ws.readyState === 1) {
      try {
        const state = game.getState(playerId);
        ws.send(JSON.stringify(state));
      } catch (e) {
        // ignore send errors
      }
    }
  }
};

wss.on('connection', (ws) => {
  const playerId = game.addPlayer(ws);
  wsToPlayer.set(ws, playerId);

  // Send initial welcome with player ID
  ws.send(
    JSON.stringify({
      type: 'welcome',
      playerId,
      arenaRadius: 500,
    })
  );

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'input') {
        game.handleInput(playerId, msg);
      } else if (msg.type === 'set_name') {
        const result = game.setPlayerName(playerId, msg.name);
        if (result && !result.ok) {
          ws.send(JSON.stringify({ type: 'name_error', error: result.error }));
        } else {
          ws.send(JSON.stringify({ type: 'name_ok', name: msg.name }));
        }
      } else if (msg.type === 'get_leaderboard') {
        const data = game.getLeaderboard();
        ws.send(JSON.stringify({ type: 'leaderboard', data }));
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    game.removePlayer(playerId);
    wsToPlayer.delete(ws);
  });

  ws.on('error', () => {
    game.removePlayer(playerId);
    wsToPlayer.delete(ws);
  });
});

game.start();

server.listen(PORT, () => {
  console.log(`Ring - Battle Royale server running on http://localhost:${PORT}`);
});

module.exports = { server, game, wss };
