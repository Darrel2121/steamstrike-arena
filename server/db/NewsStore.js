/**
 * NewsStore.js
 * Persistent news, announcements, and patch notes store for Steamstrike.
 * Persists to data/news.json with support for categories, pinned articles, and editing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_NEWS_FILE = path.join(DEFAULT_DATA_DIR, 'news.json');

const INITIAL_SEED_NEWS = [
  {
    id: 'news_beta_launch',
    title: 'Відкрите бета-тестування Steamstrike: Tactical Arena v1.0',
    category: 'Оновлення',
    tagColor: '#2ec4b6',
    summary: 'Сервери Steamstrike відкрито для всіх інженерів та бійців! Нові бойові арени, редактор карт та система прокачування.',
    content: 'Вітаємо на арені Steamstrike! У цьому релізі:\n• 4 унікальних тактичних класи бійців (Авангард, Стрілець, Джаггернаут, Диверсант)\n• Динамічний ліхтар FOV та звукові хвилі в темряві\n• Вбудований редактор бойових мап\n• Система майстерні та апгрейдів арсеналу.',
    author: 'Команда розробки Steamstrike',
    date: '06 Жовтня 2026',
    timestamp: Date.now() - 3600000,
    pinned: true
  },
  {
    id: 'news_class_balance',
    title: 'Масштабне оновлення класів: нові котли та оптика ліхтарів',
    category: 'Патч',
    tagColor: '#ff9f1c',
    summary: 'Кожен клас отримав унікальні параметри міцності, запасу пари, кута та дальності світлового променя.',
    content: 'Деталі балансу:\n• Джаггернаут отримав широкий прожектор 110° та 145 HP\n• Стрілець озброєний вузьким сфокусованим променем 55° з дальністю 550 px\n• Диверсант отримав посилений запас пари 110 PSI та прискорене охолодження\n• Покращено візуальні силуети та наплічні парові котли.',
    author: 'Головний Інженер',
    date: '06 Жовтня 2026',
    timestamp: Date.now(),
    pinned: false
  }
];

export class NewsStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir]
   * @param {string} [options.filePath]
   * @param {boolean} [options.memoryOnly]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.filePath = options.filePath || DEFAULT_NEWS_FILE;
    this.memoryOnly = options.memoryOnly ?? false;
    this.news = [];
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
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.news = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('[NewsStore] Failed to load existing news:', err.message);
    }
    this.news = [...INITIAL_SEED_NEWS];
    if (!this.memoryOnly) {
      this.scheduleSave();
    }
  }

  /**
   * Returns all news articles sorted by pinned status and timestamp.
   * @param {number} [limit=50]
   */
  getNews(limit = 50) {
    const sorted = [...this.news].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    return sorted.slice(0, limit);
  }

  getNewsById(id) {
    return this.news.find(n => n.id === id) || null;
  }

  /**
   * Creates a new news article.
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async createNews(data = {}) {
    const id = `news_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();
    const dateFormatted = `${String(now.getDate()).padStart(2, '0')} ${['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'][now.getMonth()]} ${now.getFullYear()}`;

    const article = {
      id,
      title: String(data.title || 'Новина без назви').trim().slice(0, 150),
      category: String(data.category || 'Оновлення').trim().slice(0, 50),
      tagColor: data.tagColor || (data.category === 'Патч' ? '#ff9f1c' : data.category === 'Подія' ? '#e71d36' : '#2ec4b6'),
      summary: String(data.summary || '').trim().slice(0, 300),
      content: String(data.content || '').trim().slice(0, 10000),
      author: String(data.author || 'Адміністрація').trim().slice(0, 60),
      imageUrl: data.imageUrl ? String(data.imageUrl).trim() : '',
      date: data.date || dateFormatted,
      timestamp: Date.now(),
      pinned: Boolean(data.pinned)
    };

    this.news.unshift(article);
    if (!this.memoryOnly) {
      this.scheduleSave();
    }
    return article;
  }

  /**
   * Updates an existing news article.
   * @param {string} id
   * @param {Object} patch
   * @returns {Promise<Object|null>}
   */
  async updateNews(id, patch = {}) {
    const index = this.news.findIndex(n => n.id === id);
    if (index === -1) return null;

    const existing = this.news[index];
    const updated = {
      ...existing,
      title: patch.title !== undefined ? String(patch.title).trim().slice(0, 150) : existing.title,
      category: patch.category !== undefined ? String(patch.category).trim().slice(0, 50) : existing.category,
      tagColor: patch.tagColor !== undefined ? patch.tagColor : existing.tagColor,
      summary: patch.summary !== undefined ? String(patch.summary).trim().slice(0, 300) : existing.summary,
      content: patch.content !== undefined ? String(patch.content).trim().slice(0, 10000) : existing.content,
      author: patch.author !== undefined ? String(patch.author).trim().slice(0, 60) : existing.author,
      imageUrl: patch.imageUrl !== undefined ? String(patch.imageUrl).trim() : existing.imageUrl,
      pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : existing.pinned,
      updatedAt: new Date().toISOString()
    };

    this.news[index] = updated;
    if (!this.memoryOnly) {
      this.scheduleSave();
    }
    return updated;
  }

  /**
   * Deletes an article by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteNews(id) {
    const beforeLen = this.news.length;
    this.news = this.news.filter(n => n.id !== id);
    const removed = this.news.length < beforeLen;
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
        const serialized = JSON.stringify(this.news, null, 2);
        await fs.promises.writeFile(tempPath, serialized, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        console.error('[NewsStore] Error saving news to disk:', err.message);
      }
    }).catch(err => {
      console.error('[NewsStore] Unhandled write error:', err);
    });
  }
}

export const newsStore = new NewsStore();
