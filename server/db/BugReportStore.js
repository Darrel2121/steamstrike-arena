/**
 * Bug Report & Feedback Store
 * Persists player bug reports and suggestions to data/bug_reports.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_REPORTS_FILE = path.join(DEFAULT_DATA_DIR, 'bug_reports.json');

export class BugReportStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir]
   * @param {string} [options.filePath]
   * @param {boolean} [options.memoryOnly]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.filePath = options.filePath || DEFAULT_REPORTS_FILE;
    this.memoryOnly = options.memoryOnly ?? false;
    this.reports = [];
    this.maxReports = options.maxReports || 500;
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
          this.reports = parsed;
        }
      }
    } catch (err) {
      console.warn('[BugReportStore] Failed to load existing reports:', err.message);
      this.reports = [];
    }
  }

  /**
   * Adds a new bug report.
   * @param {Object} reportData
   * @returns {Promise<Object>} Created report
   */
  async addReport(reportData = {}) {
    const id = `bug_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const report = {
      id,
      category: String(reportData.category || 'general').trim().slice(0, 50),
      description: String(reportData.description || '').trim().slice(0, 4000),
      contact: String(reportData.contact || '').trim().slice(0, 100),
      status: reportData.status || 'new', // 'new' | 'in_progress' | 'resolved' | 'rejected'
      clientInfo: reportData.clientInfo || {},
      createdAt: new Date().toISOString(),
      timestamp: Date.now()
    };

    this.reports.unshift(report);
    if (this.reports.length > this.maxReports) {
      this.reports = this.reports.slice(0, this.maxReports);
    }

    if (!this.memoryOnly) {
      this.scheduleSave();
    }

    return report;
  }

  /**
   * Updates status of a bug report.
   * @param {string} id
   * @param {string} status
   * @returns {Promise<Object|null>}
   */
  async updateReportStatus(id, status) {
    const report = this.reports.find(r => r.id === id);
    if (!report) return null;
    report.status = status;
    report.updatedAt = new Date().toISOString();
    if (!this.memoryOnly) {
      this.scheduleSave();
    }
    return report;
  }

  /**
   * Deletes a bug report.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteReport(id) {
    const beforeLen = this.reports.length;
    this.reports = this.reports.filter(r => r.id !== id);
    const removed = this.reports.length < beforeLen;
    if (removed && !this.memoryOnly) {
      this.scheduleSave();
    }
    return removed;
  }

  /**
   * Returns list of recent reports.
   * @param {number} [limit=100]
   */
  getReports(limit = 100) {
    return this.reports.slice(0, limit);
  }

  getAllReports() {
    return [...this.reports];
  }

  scheduleSave() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (!fs.existsSync(this.dataDir)) {
          await fs.promises.mkdir(this.dataDir, { recursive: true });
        }
        const tempPath = `${this.filePath}.${Date.now()}_${Math.random().toString(36).substr(2, 5)}.tmp`;
        const serialized = JSON.stringify(this.reports, null, 2);
        await fs.promises.writeFile(tempPath, serialized, 'utf8');
        await fs.promises.rename(tempPath, this.filePath);
      } catch (err) {
        console.error('[BugReportStore] Error persisting reports to disk:', err.message);
      }
    }).catch(err => {
      console.error('[BugReportStore] Unhandled write error:', err);
    });
  }
}

export const bugReportStore = new BugReportStore();
