/**
 * CharacterClasses.js
 * Definitions and mechanics for Steampunk Hero Classes and Active/Passive Abilities.
 * Provides tactical class-based synergy and dynamic combat abilities.
 */

export const CHARACTER_CLASSES = {
  vanguard: {
    id: 'vanguard',
    name: 'Авангард',
    englishName: 'Vanguard',
    role: 'Штурмовик передової',
    icon: '🛡️',
    description: 'Збалансований штурмовик у міцних латунних латах. Прориває фронт ворога за допомогою парового форсажу.',
    hpMultiplier: 1.0,
    baseHp: 100,
    speedMultiplier: 1.0,
    walkSpeed: 120,
    sprintSpeed: 200,
    maxSteam: 100,
    steamDrainRate: 30,
    steamVentRate: 20,
    lanternMultiplier: 1.0,
    lanternRange: 420,
    lanternAngleDeg: 80,
    lanternFov: (80 * Math.PI) / 180,
    proximityRadius: 55,
    accentColor: '#ffcf48',
    chassisStyle: 'brass_plate',
    passive: {
      id: 'reinforced_armor',
      name: 'Загартований панцир',
      description: 'Зменшує отримуваний урон на 20% під час дії Парового форсажу.'
    },
    ability: {
      id: 'steam_overdrive',
      name: 'Паровий форсаж',
      description: 'Миттєвий викид пари: +50% до швидкості бігу та вдвічі швидше перезаряджання на 4.5 сек.',
      cooldown: 12.0,
      duration: 4.5,
      key: 'E',
      icon: '⚡'
    }
  },

  sharpshooter: {
    id: 'sharpshooter',
    name: 'Стрілець',
    englishName: 'Sharpshooter',
    role: 'Снайпер-розвідник',
    icon: '🎯',
    description: 'Спритний снайпер із далекобійною оптикою, високою швидкістю та вузьким далекобійним променем ліхтаря.',
    hpMultiplier: 0.80,
    baseHp: 80,
    speedMultiplier: 1.08,
    walkSpeed: 130,
    sprintSpeed: 216,
    maxSteam: 90,
    steamDrainRate: 20,
    steamVentRate: 35,
    lanternMultiplier: 1.30,
    lanternRange: 550,
    lanternAngleDeg: 55,
    lanternFov: (55 * Math.PI) / 180,
    proximityRadius: 45,
    accentColor: '#5ffbf1',
    chassisStyle: 'sniper_coat',
    passive: {
      id: 'pneumatic_silencer',
      name: 'Пневмо-глушник',
      description: 'Кроки та біг генерують на 40% менший радіус звукових хвиль у тумані.'
    },
    ability: {
      id: 'aether_sonar',
      name: 'Ефірний сонар',
      description: 'Резонансна хвиля виявляє силуети всіх ворогів крізь укриття в радіусі 550 px на 4.0 сек.',
      cooldown: 14.0,
      duration: 4.0,
      key: 'E',
      icon: '📡'
    }
  },

  juggernaut: {
    id: 'juggernaut',
    name: 'Джаггернаут',
    englishName: 'Juggernaut',
    role: 'Важковаговик-захисник',
    icon: '⚙️',
    description: 'Важкоброньований титан з колосальним запасом міцності, потужним паровим котлом та широким прожектором.',
    hpMultiplier: 1.45,
    baseHp: 145,
    speedMultiplier: 0.88,
    walkSpeed: 105,
    sprintSpeed: 175,
    maxSteam: 130,
    steamDrainRate: 32,
    steamVentRate: 22,
    lanternMultiplier: 0.85,
    lanternRange: 360,
    lanternAngleDeg: 110,
    lanternFov: (110 * Math.PI) / 180,
    proximityRadius: 80,
    accentColor: '#ff7b00',
    chassisStyle: 'heavy_titan',
    passive: {
      id: 'titan_mass',
      name: 'Титанова стійкість',
      description: 'Імунітет до відкидання та уповільнення при отриманні важких влучань.'
    },
    ability: {
      id: 'steam_bastion',
      name: 'Паровий бастіон',
      description: 'Розгортає перед собою захисний кінетичний екран (80 HP), що блокує ворожі кулі на 5.0 сек.',
      cooldown: 16.0,
      duration: 5.0,
      key: 'E',
      icon: '🛡️'
    }
  },

  infiltrator: {
    id: 'infiltrator',
    name: 'Диверсант',
    englishName: 'Infiltrator',
    role: 'Тіньовий майстер засідок',
    icon: '🗡️',
    description: 'Швидкий та небезпечний тактик із димовими шашками, підвищеним запасом пари та надшвидким охолодженням котла.',
    hpMultiplier: 0.90,
    baseHp: 90,
    speedMultiplier: 1.18,
    walkSpeed: 142,
    sprintSpeed: 236,
    maxSteam: 110,
    steamDrainRate: 20,
    steamVentRate: 40,
    lanternMultiplier: 0.95,
    lanternRange: 400,
    lanternAngleDeg: 72,
    lanternFov: (72 * Math.PI) / 180,
    proximityRadius: 60,
    accentColor: '#b33939',
    chassisStyle: 'shadow_cloak',
    passive: {
      id: 'backstab_edge',
      name: 'Удар у фланг',
      description: '+25% урону при стрільбі у спину чи збоку від лінії прицілу ворога.'
    },
    ability: {
      id: 'smoke_screen',
      name: 'Димова завіса',
      description: 'Скидає димову шашку (радіус 180 px), яка блокує промені ліхтарів та приховує диверсанта на 5.0 сек.',
      cooldown: 13.0,
      duration: 5.0,
      key: 'E',
      icon: '💨'
    }
  }
};

export const DEFAULT_CLASS_ID = 'vanguard';

/**
 * Returns class definition by ID with fallback to vanguard.
 * @param {string} classId
 * @returns {Object}
 */
export function getClassDefinition(classId) {
  return CHARACTER_CLASSES[classId] || CHARACTER_CLASSES[DEFAULT_CLASS_ID];
}
