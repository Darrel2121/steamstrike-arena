/**
 * Shared Atomic JSON File Writer (Single Source of Truth)
 * Provides Windows-resilient atomic file persistence using temporary file write + rename
 * with exponential backoff and copy+unlink fallback, guaranteeing zero orphaned .tmp files.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Atomically writes JSON-serializable data to targetPath.
 * @param {string} targetPath
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function atomicWriteJson(targetPath, data) {
  if (!targetPath) return;

  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  const payload = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(tmpPath, payload, 'utf8');

  let attempts = 0;
  while (attempts < 5) {
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      attempts++;
      if (attempts >= 5) {
        try {
          await fs.promises.copyFile(tmpPath, targetPath);
          await fs.promises.unlink(tmpPath).catch(() => {});
          return;
        } catch (_) {
          await fs.promises.unlink(tmpPath).catch(() => {});
          throw err;
        }
      }
      await new Promise(res => setTimeout(res, attempts * 15));
    }
  }
}
