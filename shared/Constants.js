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
    maxRadius: 168,
    duration: 1.2,
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

// Game Modes (Five distinct match rulesets including PvE Wave Defense)
export const GAME_MODES = {
  SOLO_ELIM: 'solo_elim', // Кожен за себе (Остаточна смерть / Battle Royale)
  TEAM_ELIM: 'team_elim', // Командний бій (Остаточна смерть / Last Team Standing)
  FFA_DM: 'ffa_dm',       // Кожен сам за себе (Відродження / Deathmatch)
  TEAM_DM: 'team_dm',     // Командний бій (Відродження / Team Deathmatch)
  WAVE_DEFENSE: 'wave_defense' // PvE: Оборона Парового Реактора від хвиль ворогів
};

// PvE Steam Core & Wave Constants
export const STEAM_CORE_MAX_HP = 1000;
export const STEAM_CORE_RADIUS = 36;
export const STEAM_CORE_REPAIR_PER_WAVE = 250;
export const WAVE_PREP_DURATION = 12; // 12 seconds intermission between waves

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
  },
  [GAME_MODES.WAVE_DEFENSE]: {
    id: 'wave_defense',
    name: 'Оборона Парового Реактора (PvE)',
    shortName: 'Оборона Реактора',
    badge: 'PVE ОБОРОНА',
    isTeam: true,
    hasRespawn: true,
    defaultTargetKills: 5,
    description: 'Захищайте центральне Парове Ядро від наступаючих хвиль ворожих автоматонів. Переживіть 5 хвиль для перемоги!'
  }
};

// Bot Intelligence & AI Difficulty Levels
export const BOT_DIFFICULTIES = {
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard',
  NIGHTMARE: 'nightmare'
};

export const BOT_DIFFICULTY_CONFIGS = {
  [BOT_DIFFICULTIES.EASY]: {
    id: 'easy',
    name: 'Рекрут (Легкий)',
    shortName: 'Рекрут',
    badge: 'ЛЕГКИЙ',
    icon: '🟢',
    color: '#10b981',
    description: 'Повільна реакція (0.95с), без стрільби на випередження, спокійний помірний рух',
    reactionDelay: 0.95,
    maxSpeed: 105,
    turnRate: 1.2 * Math.PI,
    range: 320,
    fireInterval: 0.65,
    leadAim: false,
    abilityChance: 0.20
  },
  [BOT_DIFFICULTIES.NORMAL]: {
    id: 'normal',
    name: 'Ветеран (Звичайний)',
    shortName: 'Ветеран',
    badge: 'ЗВИЧАЙНИЙ',
    icon: '🟡',
    color: '#ffcf48',
    description: 'Тактичне патрулювання, реалістичний людський приціл (0.65с), плавний розворот та помірні стрейфи',
    reactionDelay: 0.65,
    maxSpeed: 125,
    turnRate: 2.0 * Math.PI,
    range: 400,
    fireInterval: 0.48,
    leadAim: true,
    abilityChance: 0.45
  },
  [BOT_DIFFICULTIES.HARD]: {
    id: 'hard',
    name: 'Елітний автоматон (Важкий)',
    shortName: 'Еліта',
    badge: 'ВАЖКИЙ',
    icon: '🔴',
    color: '#f97316',
    description: 'Балістичне випередження, тактичні стрейфи, швидка реакція (0.38с), використання укриттів',
    reactionDelay: 0.38,
    maxSpeed: 150,
    turnRate: 3.5 * Math.PI,
    range: 460,
    fireInterval: 0.36,
    leadAim: true,
    abilityChance: 0.75
  },
  [BOT_DIFFICULTIES.NIGHTMARE]: {
    id: 'nightmare',
    name: 'Кошмарний титан (Екстремальний)',
    shortName: 'Титан',
    badge: 'ЕКСТРЕМ',
    icon: '🟣',
    color: '#ef4444',
    description: 'Блискавичні рефлекси (0.18с), нещадний фланг, висока швидкість та часті парові вміння',
    reactionDelay: 0.18,
    maxSpeed: 170,
    turnRate: 5.5 * Math.PI,
    range: 520,
    fireInterval: 0.26,
    leadAim: true,
    abilityChance: 0.95
  }
};



