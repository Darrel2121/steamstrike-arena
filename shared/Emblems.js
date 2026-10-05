/**
 * Steampunk Heraldic Emblems & Crests
 * Collection of heraldic insignias representing different guilds, orders, and engineering factions.
 */

export const DEFAULT_EMBLEM_ID = 'gear';

export const STEAMPUNK_EMBLEMS = [
  {
    id: 'gear',
    icon: '⚙️',
    name: 'Гільдія Шестерень',
    motto: 'Точність, баланс та вічний рух',
    color: '#d4af37'
  },
  {
    id: 'falcon',
    icon: '🦅',
    name: 'Латунний Сокіл',
    motto: 'Пильне око крізь найтемніший туман',
    color: '#e5a93b'
  },
  {
    id: 'wolf',
    icon: '🐺',
    name: 'Паровий Вовк',
    motto: 'Нічний мисливець підземних лабіринтів',
    color: '#80b5ff'
  },
  {
    id: 'fox',
    icon: '🦊',
    name: 'Мідний Лис',
    motto: 'Хитрість, швидкість та невидимий маневр',
    color: '#ff7a3d'
  },
  {
    id: 'lightning',
    icon: '⚡',
    name: 'Ефірна Тесла',
    motto: 'Незламний розряд високої напруги',
    color: '#38ef7d'
  },
  {
    id: 'shield',
    icon: '🛡️',
    name: 'Залізний Бастіон',
    motto: 'Непохитна броня та сталева воля',
    color: '#a8b2c1'
  },
  {
    id: 'anchor',
    icon: '⚓',
    name: 'Цепелінний Якір',
    motto: 'Глибинна витримка небесних фрегатів',
    color: '#4facfe'
  },
  {
    id: 'skull',
    icon: '💀',
    name: 'Сталевий Корсар',
    motto: 'Безстрашний абордаж та фатальний залп',
    color: '#f857a6'
  },
  {
    id: 'dragon',
    icon: '🐉',
    name: 'Паровий Дракон',
    motto: 'Тиск пари, що спопеляє будь-яку перешкоду',
    color: '#ff416c'
  },
  {
    id: 'flame',
    icon: '🔥',
    name: 'Пекельне Горно',
    motto: 'Загартовані у найгарячішому полумʼї',
    color: '#ff8c00'
  },
  {
    id: 'key',
    icon: '🗝️',
    name: 'Алхімічний Ключ',
    motto: 'Відмикач таємниць старого світу',
    color: '#ffd200'
  },
  {
    id: 'crown',
    icon: '👑',
    name: 'Імперський Хронометр',
    motto: 'Владика часу та бездоганної інженерії',
    color: '#f39c12'
  }
];

export const STEAMPUNK_EMBLEMS_MAP = Object.freeze(
  STEAMPUNK_EMBLEMS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {})
);

/**
 * Returns emblem definition by ID, defaulting to 'gear'.
 * @param {string} emblemId
 * @returns {{ id: string, icon: string, name: string, motto: string, color: string }}
 */
export function getEmblemDefinition(emblemId) {
  if (emblemId && STEAMPUNK_EMBLEMS_MAP[emblemId]) {
    return STEAMPUNK_EMBLEMS_MAP[emblemId];
  }
  return STEAMPUNK_EMBLEMS_MAP[DEFAULT_EMBLEM_ID];
}

export default STEAMPUNK_EMBLEMS;
