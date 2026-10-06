/**
 * Steampunk Tactical Asset Manager
 * Manages preloading, offscreen scaling, pattern caching, and high-definition
 * visual sprites for the Canvas 2D rendering pipeline.
 *
 * Fully resilient to Node.js headless test environments (graceful null fallback).
 */

export class AssetManager {
  constructor() {
    this.images = new Map();
    this.patterns = new Map();
    this.isReady = false;
    this.loadPromise = null;

    this.manifest = {
      floor: '/assets/floor_steampunk.jpg',
      wall: '/assets/wall_steampunk.jpg',
      obstacle: '/assets/obstacle_steampunk.jpg',
      pickup: '/assets/pickup_steampunk.png',
      backdrop: '/assets/arena_backdrop.jpg'
    };

    this.init();
  }

  /**
   * Begins asynchronous loading of manifest assets if in browser environment.
   */
  init() {
    if (typeof Image === 'undefined') {
      return;
    }

    const promises = Object.entries(this.manifest).map(([key, src]) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        img.onload = () => {
          this.images.set(key, img);
          resolve();
        };
        img.onerror = () => {
          // Keep resilient on missing or network failure
          resolve();
        };
      });
    });

    this.loadPromise = Promise.all(promises).then(() => {
      this.isReady = true;
      this.buildPatterns();
    });
  }

  /**
   * Pre-generates seamless repeating patterns at optimal tile scale (240x240 for 40px grid).
   */
  buildPatterns() {
    if (typeof document === 'undefined') return;

    const floorImg = this.images.get('floor');
    if (floorImg && floorImg.naturalWidth) {
      try {
        const offscreen = document.createElement('canvas');
        const patternSize = 240; // Exactly 6 grid tiles (6 * 40 = 240px)
        offscreen.width = patternSize;
        offscreen.height = patternSize;
        const offCtx = offscreen.getContext('2d');
        if (offCtx) {
          offCtx.drawImage(floorImg, 0, 0, patternSize, patternSize);
          this.patterns.set('floor', offscreen);
        }
      } catch (_) {}
    }
  }

  /**
   * Returns CanvasPattern or null.
   * @param {CanvasRenderingContext2D} ctx
   * @returns {CanvasPattern|null}
   */
  getFloorPattern(ctx) {
    if (!ctx) return null;
    const cached = this.patterns.get('floor_compiled');
    if (cached) return cached;

    const source = this.patterns.get('floor') || this.images.get('floor');
    if (source && ctx.createPattern) {
      try {
        const pattern = ctx.createPattern(source, 'repeat');
        if (pattern) {
          this.patterns.set('floor_compiled', pattern);
          return pattern;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * @param {string} key
   * @returns {HTMLImageElement|null}
   */
  getImage(key) {
    const img = this.images.get(key);
    return (img && img.complete && img.naturalWidth > 0) ? img : null;
  }

  get wallImage() {
    return this.getImage('wall');
  }

  get obstacleImage() {
    return this.getImage('obstacle');
  }

  get playerImage() {
    return null;
  }

  get botImage() {
    return null;
  }

  get pickupImage() {
    return this.getImage('pickup');
  }

  get backdropImage() {
    return this.getImage('backdrop');
  }
}

// Global singleton instance
export const assetManager = new AssetManager();
