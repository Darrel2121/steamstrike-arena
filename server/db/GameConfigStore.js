/**
 * GameConfigStore.js
 * Persistent storage and live synchronization engine for global game configuration.
 * Persists to data/game_settings.json and notifies listeners on update.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDefaultGameSettings,
  sanitizeGameSettings,
  GAME_SETTINGS_SCHEMA,
  GAME_SETTING_CATEGORIES,
  GAME_SETTING_PRESETS
} from '../../shared/GameSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'game_settings.json');

export class GameConfigStore {
  constructor() {
    this.currentSettings = getDefaultGameSettings();
    this.adminPassword = process.env.ADMIN_PASSWORD || 'steamstrike2026';
    this.changeListeners = new Set();
    this.isLoaded = false;
    this.loadFromDisk();
  }

  /**
   * Loads persisted settings from disk if available
   */
  loadFromDisk() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.currentSettings = sanitizeGameSettings(parsed);
      } else {
        this.currentSettings = getDefaultGameSettings();
        this.saveToDisk();
      }
      this.isLoaded = true;
    } catch (err) {
      console.warn('[GameConfigStore] Failed to load settings from disk, using defaults:', err.message);
      this.currentSettings = getDefaultGameSettings();
    }
  }

  /**
   * Persists current settings to disk safely
   */
  saveToDisk() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = JSON.stringify(this.currentSettings, null, 2);
      fs.writeFileSync(CONFIG_FILE, data, 'utf-8');
    } catch (err) {
      console.error('[GameConfigStore] Error saving settings to disk:', err);
    }
  }

  /**
   * Returns current active settings
   */
  getSettings() {
    return { ...this.currentSettings };
  }

  /**
   * Updates partial or full settings
   * @param {Object} partialSettings
   * @returns {Object} Updated settings
   */
  updateSettings(partialSettings = {}) {
    const merged = { ...this.currentSettings, ...partialSettings };
    this.currentSettings = sanitizeGameSettings(merged);
    this.saveToDisk();
    this.notifyListeners();
    return this.getSettings();
  }

  /**
   * Applies a predefined preset
   * @param {string} presetId
   * @returns {Object} Updated settings
   */
  applyPreset(presetId) {
    const preset = GAME_SETTING_PRESETS[presetId];
    if (!preset) {
      throw new Error(`Невідомий пресет: ${presetId}`);
    }
    this.currentSettings = sanitizeGameSettings(preset.settings);
    this.saveToDisk();
    this.notifyListeners();
    return this.getSettings();
  }

  /**
   * Resets all settings to original defaults
   * @returns {Object} Default settings
   */
  resetToDefaults() {
    this.currentSettings = getDefaultGameSettings();
    this.saveToDisk();
    this.notifyListeners();
    return this.getSettings();
  }

  /**
   * Verifies admin password
   * @param {string} password
   * @returns {boolean}
   */
  verifyAdminPassword(password) {
    if (!password) return false;
    const clean = String(password).trim();
    return clean === this.adminPassword;
  }

  /**
   * Subscribes a listener callback to settings changes
   * @param {Function} callback
   */
  onSettingsChange(callback) {
    if (typeof callback === 'function') {
      this.changeListeners.add(callback);
    }
  }

  /**
   * Unsubscribes a listener
   * @param {Function} callback
   */
  offSettingsChange(callback) {
    this.changeListeners.delete(callback);
  }

  /**
   * Notifies all registered listeners
   */
  notifyListeners() {
    const settings = this.getSettings();
    for (const listener of this.changeListeners) {
      try {
        listener(settings);
      } catch (err) {
        console.error('[GameConfigStore] Listener error:', err);
      }
    }
  }

  /**
   * Returns schema, categories, presets and current values for Admin UI
   */
  getFullAdminPayload() {
    return {
      settings: this.getSettings(),
      defaults: getDefaultGameSettings(),
      schema: GAME_SETTINGS_SCHEMA,
      categories: GAME_SETTING_CATEGORIES,
      presets: GAME_SETTING_PRESETS
    };
  }
}

export const gameConfigStore = new GameConfigStore();
