/**
 * Shared Game Constants & Design Tokens
 * Used across client and server subsystems
 */

export const TILE_SIZE = 40;
export const DEFAULT_GRID_WIDTH = 20;
export const DEFAULT_GRID_HEIGHT = 20;
export const MIN_GRID_DIMENSION = 10;
export const MAX_GRID_DIMENSION = 100;

export const SERVER_TICK_RATE = 30; // 30 Hz
export const TICK_INTERVAL = 1000 / SERVER_TICK_RATE; // ~33.33ms

// Player & Movement Kinematics (pixels per second)
export const PLAYER_WALK_SPEED = 120;
export const PLAYER_RUN_SPEED = 220;
export const PLAYER_RADIUS = 16;
export const PLAYER_MAX_HP = 100;
export const PLAYER_STAMINA_MAX = 100;
export const PLAYER_STAMINA_DRAIN_RUN = 30; // stamina/s
export const PLAYER_STAMINA_RECOVER = 20; // stamina/s

// Tactical Lantern Vision & Line-of-Sight
export const LANTERN_FOV_DEG = 80;
export const LANTERN_FOV_RAD = (Math.PI * LANTERN_FOV_DEG) / 180;
export const LANTERN_FOV_HALF = LANTERN_FOV_RAD / 2; // +/- 40 deg
export const LANTERN_RANGE = 420; // px
export const PROXIMITY_RADIUS = 45; // 360-degree awareness bubble around player

// Combat & Projectile Kinematics
export const PROJECTILE_SPEED = 1800; // px/s
export const PROJECTILE_RADIUS = 3.5; // px
export const PROJECTILE_LIFETIME = 1.2; // seconds

// Sound Events & Propagation
export const SOUND_SPEED = 400; // px/s
export const SOUND_CONFIGS = {
  footstep: {
    maxRadius: 90,
    duration: 0.9,
    intensity: 0.8,
    color: 'rgba(80, 227, 230, 0.75)'
  },
  gunfire: {
    maxRadius: 240,
    duration: 1.4,
    intensity: 1.0,
    color: 'rgba(255, 110, 30, 0.85)'
  },
  reload: {
    maxRadius: 120,
    duration: 0.8,
    intensity: 0.6,
    color: 'rgba(240, 200, 80, 0.70)'
  }
};

// Steampunk Design Tokens & Theme Colors
export const THEME_COLORS = {
  ambientVoid: '#0b0d11',
  brassPrimary: '#c59b27',
  brassGlow: '#ffcf48',
  copperWarm: '#b87333',
  copperDark: '#703816',
  ironDark: '#22262d',
  ironRivet: '#3c434f',
  cobbleFloor: '#1c2026',
  lanternCore: '#fff2b2',
  lanternCone: 'rgba(255, 185, 60, 0.28)',
  soundFootstep: 'rgba(80, 227, 230, 0.75)',
  soundGunfire: 'rgba(255, 110, 30, 0.85)',
  soundReload: 'rgba(240, 200, 80, 0.70)',
  healthFull: '#2ec4b6',
  healthCritical: '#e71d36'
};

// Storage Keys
export const STORAGE_KEY_CUSTOM_MAP = 'clockwork_tactical_custom_map';

// Game Modes (Four distinct match rulesets)
export const GAME_MODES = {
  SOLO_ELIM: 'solo_elim', // Кожен за себе (Остаточна смерть / Battle Royale)
  TEAM_ELIM: 'team_elim', // Командний бій (Остаточна смерть / Last Team Standing)
  FFA_DM: 'ffa_dm',       // Кожен сам за себе (Відродження / Deathmatch)
  TEAM_DM: 'team_dm'      // Командний бій (Відродження / Team Deathmatch)
};

export const GAME_MODE_CONFIGS = {
  [GAME_MODES.SOLO_ELIM]: {
    id: 'solo_elim',
    name: 'Кожен за себе (Остаточна смерть)',
    shortName: 'Кожен за себе',
    badge: 'ВИЖИВАННЯ',
    isTeam: false,
    hasRespawn: false,
    defaultTargetKills: 0,
    description: 'Останній живий боєць здобуває тріумф'
  },
  [GAME_MODES.TEAM_ELIM]: {
    id: 'team_elim',
    name: 'Командний бій (Остаточна смерть)',
    shortName: 'Командний бій',
    badge: 'КОМАНДНЕ ВИЖИВАННЯ',
    isTeam: true,
    hasRespawn: false,
    defaultTargetKills: 0,
    description: 'Бій двох команд (Парові Вовки vs Мідні Лиси) до повного знищення ворога'
  },
  [GAME_MODES.FFA_DM]: {
    id: 'ffa_dm',
    name: 'Кожен сам за себе (З відродженням)',
    shortName: 'FFA Deathmatch',
    badge: 'FFA DM',
    isTeam: false,
    hasRespawn: true,
    defaultTargetKills: 10,
    description: 'Миттєве відродження після загибелі. Перемагає той, хто першим набере ліміт кілів'
  },
  [GAME_MODES.TEAM_DM]: {
    id: 'team_dm',
    name: 'Командний бій (З відродженням)',
    shortName: 'Командний DM',
    badge: 'КОМАНДНИЙ DM',
    isTeam: true,
    hasRespawn: true,
    defaultTargetKills: 15,
    description: 'Командне протистояння з відродженням. Перемагає команда, що першою досягне ліміту кілів'
  }
};


