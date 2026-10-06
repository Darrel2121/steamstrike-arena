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
    speedMultiplier: 1.0,
    lanternMultiplier: 1.0,
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
    description: 'Спритний стрілець з далекобійною оптикою. Просвічує супротивників крізь темряву та стіни ефірним сонаром.',
    hpMultiplier: 0.85,
    speedMultiplier: 1.08,
    lanternMultiplier: 1.25,
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
    description: 'Важкоброньований паровий автоматон з колосальним запасом міцності та фронтальним бастіоном.',
    hpMultiplier: 1.35,
    speedMultiplier: 0.90,
    lanternMultiplier: 0.95,
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
    description: 'Швидкий та небезпечний тактик, що вміє зникати у щільній алхімічній димовій завісі.',
    hpMultiplier: 0.90,
    speedMultiplier: 1.18,
    lanternMultiplier: 0.95,
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
