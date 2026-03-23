'use strict';

const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '..', 'leaderboard.json');

/**
 * Simple file-backed leaderboard store.
 * Stores { nickname: { wins: number } } persisted to a JSON file.
 */
class Leaderboard {
  constructor(filePath) {
    this.filePath = filePath || LEADERBOARD_FILE;
    this.data = {}; // nickname -> { wins: number }
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch (e) {
      // File doesn't exist or is invalid — start fresh
      this.data = {};
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save leaderboard:', e.message);
    }
  }

  /**
   * Increment win count for a nickname. Creates entry if it doesn't exist.
   */
  recordWin(nickname) {
    if (!nickname || typeof nickname !== 'string') return;
    if (!this.data[nickname]) {
      this.data[nickname] = { wins: 0 };
    }
    this.data[nickname].wins += 1;
    this._save();
  }

  /**
   * Get the leaderboard sorted by wins descending.
   * Returns array of { rank, nickname, wins }.
   */
  getRanked() {
    const entries = Object.entries(this.data)
      .map(([nickname, info]) => ({ nickname, wins: info.wins }))
      .sort((a, b) => b.wins - a.wins);

    return entries.map((entry, index) => ({
      rank: index + 1,
      nickname: entry.nickname,
      wins: entry.wins,
    }));
  }

  /**
   * Check if a nickname exists in the leaderboard.
   */
  hasNickname(nickname) {
    return nickname in this.data;
  }
}

module.exports = { Leaderboard, LEADERBOARD_FILE };
