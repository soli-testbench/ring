'use strict';

const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '..', 'leaderboard.json');

// Reserved JS property names that must never be used as object keys
const RESERVED_NAMES = new Set([
  '__proto__', 'constructor', 'prototype',
  'hasownproperty', 'isprototypeof', 'tostring',
  'valueof', 'tolocalestring', 'propertyisenumerable',
]);

/**
 * Check if a nickname is a reserved JS property name (case-insensitive).
 */
function isReservedName(name) {
  return RESERVED_NAMES.has(name.toLowerCase());
}

/**
 * Validate the shape of loaded leaderboard data.
 * Returns a sanitized copy containing only valid { nickname: { wins: number } } entries.
 */
function validateLeaderboardData(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return Object.create(null);
  }
  const clean = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (isReservedName(key)) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.wins === 'number' &&
      Number.isFinite(value.wins) &&
      value.wins >= 0
    ) {
      clean[key] = { wins: Math.floor(value.wins) };
    }
  }
  return clean;
}

/**
 * File-backed leaderboard store.
 * Stores { nickname: { wins: number } } persisted to a JSON file.
 * Uses Object.create(null) to avoid prototype pollution.
 */
class Leaderboard {
  constructor(filePath) {
    this.filePath = filePath || LEADERBOARD_FILE;
    this.data = Object.create(null); // nickname -> { wins: number }
    this._saving = false;
    this._pendingSave = false;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.data = validateLeaderboardData(parsed);
    } catch (e) {
      // File doesn't exist or is invalid — start fresh
      this.data = Object.create(null);
    }
  }

  /**
   * Async atomic save: write to a temp file then rename.
   * Coalesces concurrent save requests.
   */
  _save() {
    if (this._saving) {
      this._pendingSave = true;
      return;
    }
    this._saving = true;

    const uniqueSuffix = process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
    const tmpFile = this.filePath + '.tmp.' + uniqueSuffix;
    const content = JSON.stringify(this.data, null, 2);

    fs.writeFile(tmpFile, content, 'utf-8', (writeErr) => {
      if (writeErr) {
        console.error('Failed to write leaderboard temp file:', writeErr.message);
        this._saving = false;
        return;
      }
      fs.rename(tmpFile, this.filePath, (renameErr) => {
        if (renameErr) {
          console.error('Failed to rename leaderboard file:', renameErr.message);
          fs.unlink(tmpFile, () => {});
        }
        this._saving = false;
        if (this._pendingSave) {
          this._pendingSave = false;
          this._save();
        }
      });
    });
  }

  /**
   * Increment win count for a nickname. Creates entry if it doesn't exist.
   */
  recordWin(nickname) {
    if (!nickname || typeof nickname !== 'string') return;
    if (isReservedName(nickname)) return;
    if (!(nickname in this.data)) {
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
    const entries = Object.keys(this.data)
      .map((nickname) => ({ nickname, wins: this.data[nickname].wins }))
      .sort((a, b) => b.wins - a.wins);

    return entries.map((entry, index) => ({
      rank: index + 1,
      nickname: entry.nickname,
      wins: entry.wins,
    }));
  }

  /**
   * Check if a nickname exists in the persisted leaderboard (case-insensitive).
   */
  hasNickname(nickname) {
    const lower = nickname.toLowerCase();
    for (const key of Object.keys(this.data)) {
      if (key.toLowerCase() === lower) return true;
    }
    return false;
  }

  /**
   * Get the canonical (persisted) form of a nickname, or null if not found.
   */
  getCanonicalNickname(nickname) {
    const lower = nickname.toLowerCase();
    for (const key of Object.keys(this.data)) {
      if (key.toLowerCase() === lower) return key;
    }
    return null;
  }
}

module.exports = { Leaderboard, LEADERBOARD_FILE, isReservedName, validateLeaderboardData };
