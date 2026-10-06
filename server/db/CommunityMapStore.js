/**
 * Community Map Store
 * Manages player-submitted custom battle arenas and administrative moderation status.
 * Persists data to data/community_maps.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMap } from '../../shared/MapSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_MAPS_FILE = path.join(DEFAULT_DATA_DIR, 'community_maps.json');

export class CommunityMapStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir]
   * @param {string} [options.filePath]
   * @param {boolean} [options.memoryOnly]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.filePath = options.filePath || DEFAULT_MAPS_FILE;
    this.memoryOnly = options.memoryOnly ?? false;
    this.maps = [];
    this.writeQueue = Promise.resolve();

    if (!this.memoryOnly) {
      this.initSync();
    }
  }

  initSync() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.maps = parsed;
        }
      }
    } catch (err) {
      console.warn('[CommunityMapStore] Failed to load existing community maps:', err.message);
      this.maps = [];
    }
  }

  /**
   * Submits a custom arena for moderation.
   * @param {Object} submission
   * @returns {Promise<Object>} Created map record
   */
  async submitMap(submission = {}) {
    const rawMap = submission.map;
    if (!rawMap || typeof rawMap !== 'object') {
      throw new Error('Не передано структуру карти (map object)');
    }

    const validation = validateMap(rawMap);
    if (!validation.valid) {
      throw new Error(`Карта не пройшла перевірку: ${validation.errors.join(', ')}`);
    }

    const id = `cmap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const mapName = String(submission.name || rawMap.name || 'Невідома Арена').trim().slice(0, 50);
    const author = String(submission.author || 'Анонімний Інженер').trim().slice(0, 40);
    const authorId = submission.authorId ? String(submission.authorId) : null;
    const description = String(submission.description || '').trim().slice(0, 1000);

    const record = {
      id,
      name: mapName,
      author,
      authorId,
      description,
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      submittedAt: Date.now(),
      reviewedAt: null,
      reviewNote: '',
      map: {
        id: id,
        name: mapName,
        width: rawMap.width || 20,
        height: rawMap.height || 20,
        tileSize: rawMap.tileSize || 40,
        tiles: Array.isArray(rawMap.tiles) ? [...rawMap.tiles] : [],
        spawns: Array.isArray(rawMap.spawns) ? JSON.parse(JSON.stringify(rawMap.spawns)) : [],
        pickups: Array.isArray(rawMap.pickups) ? JSON.parse(JSON.stringify(rawMap.pickups)) : [],
        decorations: Array.isArray(rawMap.decorations) ? JSON.parse(JSON.stringify(rawMap.decorations)) : []
      }
    };

    this.maps.unshift(record);

    if (!this.memoryOnly) {
      this.scheduleSave();
    }

    return record;
  }

  /**
   * Returns list of officially approved published community maps for in-game lobbies.
   */
  getPublishedMaps() {
    return this.maps
      .filter(m => m.status === 'approved')
      .map(m => ({
        id: m.id,
        name: m.name,
        author: m.author,
        description: m.description,
        submittedAt: m.submittedAt,
        map: m.map
      }));
  }

  /**
   * Returns all maps (with optional status filter) for administration.
   * @param {string} [statusFilter]
   */
  getAllMaps(statusFilter = null) {
    if (statusFilter && statusFilter !== 'all') {
      return this.maps.filter(m => m.status === statusFilter);
    }
    return [...this.maps];
  }

  /**
   * Returns map by ID.
   * @param {string} id
   */
  getMapById(id) {
    return this.maps.find(m => m.id === id) || null;
  }

  /**
   * Updates moderation status of a map submission.
   * @param {string} id
   * @param {'approved' | 'rejected' | 'pending'} status
   * @param {string} [reviewNote]
   */
  async updateMapStatus(id, status, reviewNote = '') {
    const map = this.maps.find(m => m.id === id);
    if (!map) return null;

    map.status = status;
    map.reviewedAt = Date.now();
    if (reviewNote !== undefined) {
      map.reviewNote = String(reviewNote).trim().slice(0, 500);
    }

    if (!this.memoryOnly) {
      this.scheduleSave();
    }

    return map;
  }

  /**
   * Deletes a map submission permanently.
   * @param {string} id
   */
  async deleteMap(id) {
    const beforeLen = this.maps.length;
    this.maps = this.maps.filter(m => m.id !== id);
    const removed = this.maps.length < beforeLen;

    if (removed && !this.memoryOnly) {
      this.scheduleSave();
    }

    return removed;
  }

  scheduleSave() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (!fs.existsSync(this.dataDir)) {
          await fs.promises.mkdir(this.dataDir, { recursive: true });
        }
        const tempPath = `${this.filePath}.${Date.now()}_${Math.random().toString(36).substr(2, 5)}.tmp`;
        const serialized = JSON.stringify(this.maps, null, 2);
        await fs.promises.writeFile(tempPath, serialized, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        console.error('[CommunityMapStore] Error persisting maps to disk:', err.message);
      }
    }).catch(err => {
      console.error('[CommunityMapStore] Unhandled write error:', err);
    });
  }
}

export const communityMapStore = new CommunityMapStore();
