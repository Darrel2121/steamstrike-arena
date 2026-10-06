/**
 * Shared Game Settings & Runtime Configuration Schema
 * Single source of truth for global adjustable game parameters.
 */

export const GAME_SETTING_CATEGORIES = {
  movement: {
    id: 'movement',
    title: '🏃 Рух та гравець',
    description: 'Параметри швидкості пересування, здоров\'я та витривалості парового манометра'
  },
  vision: {
    id: 'vision',
    title: '🔦 Ліхтар та огляд',
    description: 'Кут та дальність направленого променя, зона 360° тактичного сприйняття та маскування'
  },
  acoustics: {
    id: 'acoustics',
    title: '🔊 Акустика та звук',
    description: 'Швидкість поширення звукових хвиль у темряві та радіуси детекції шумів'
  },
  combat: {
    id: 'combat',
    title: '💥 Балістика та зброя',
    description: 'Швидкість снарядів, тривалість польоту, глобальний множник урону та іскри'
  },
  bots: {
    id: 'bots',
    title: '🤖 Штучний інтелект ботів',
    description: 'Швидкість реакції та поведінкові фактори автоматонів для різних рівнів складності'
  },
  economy: {
    id: 'economy',
    title: '💰 Економіка та нагороди',
    description: 'Кількість досвіду (XP), латунного брухту (Scrap) та ефірних ядер (Cores) за матчі'
  },
  server: {
    id: 'server',
    title: '🌐 Сервер та матч',
    description: 'Частота симуляції (Tick Rate), тривалість розминки та ліміти очок'
  }
};

export const GAME_SETTINGS_SCHEMA = [
  // --- Movement & Player ---
  {
    key: 'playerWalkSpeed',
    category: 'movement',
    label: 'Швидкість ходьби',
    unit: 'px/s',
    type: 'number',
    min: 40,
    max: 350,
    step: 5,
    default: 120,
    description: 'Базова швидкість звичайного пересування бійця без спринту'
  },
  {
    key: 'playerRunSpeed',
    category: 'movement',
    label: 'Швидкість бігу (спринт)',
    unit: 'px/s',
    type: 'number',
    min: 80,
    max: 500,
    step: 5,
    default: 220,
    description: 'Максимальна швидкість під час утримання Shift (паровий форсаж)'
  },
  {
    key: 'playerMaxHp',
    category: 'movement',
    label: 'Базове здоров\'я бійця',
    unit: 'HP',
    type: 'number',
    min: 20,
    max: 500,
    step: 5,
    default: 100,
    description: 'Початковий рівень максимального здоров\'я гравця 1-го рівня'
  },
  {
    key: 'playerRadius',
    category: 'movement',
    label: 'Радіус колізії гравця',
    unit: 'px',
    type: 'number',
    min: 8,
    max: 30,
    step: 1,
    default: 16,
    description: 'Фізичний радіус хітбоксу бійця для стін та куль'
  },
  {
    key: 'staminaMax',
    category: 'movement',
    label: 'Максимум витривалості',
    unit: 'PSI',
    type: 'number',
    min: 20,
    max: 300,
    step: 5,
    default: 100,
    description: 'Місткість парового манометра витривалості'
  },
  {
    key: 'staminaDrainRun',
    category: 'movement',
    label: 'Витрата тиску на біг',
    unit: 'PSI/s',
    type: 'number',
    min: 0,
    max: 100,
    step: 2,
    default: 30,
    description: 'Скільки очок тиску пари витрачається за секунду спринту'
  },
  {
    key: 'staminaRecover',
    category: 'movement',
    label: 'Швидкість скидання пари (відновлення)',
    unit: 'PSI/s',
    type: 'number',
    min: 5,
    max: 100,
    step: 2,
    default: 20,
    description: 'Швидкість пасивної регенерації витривалості під час спокою чи ходьби'
  },

  // --- Tactical Lantern & Vision ---
  {
    key: 'lanternFovDeg',
    category: 'vision',
    label: 'Кут променя ліхтаря',
    unit: '°',
    type: 'number',
    min: 30,
    max: 360,
    step: 5,
    default: 80,
    description: 'Сектор конуса направленого ліхтаря (80° за замовчуванням)'
  },
  {
    key: 'lanternRange',
    category: 'vision',
    label: 'Дальність світла ліхтаря',
    unit: 'px',
    type: 'number',
    min: 150,
    max: 900,
    step: 10,
    default: 420,
    description: 'Максимальна дистанція освітлення темряви ліхтарем'
  },
  {
    key: 'proximityRadius',
    category: 'vision',
    label: 'Зона кругового сприйняття 360°',
    unit: 'px',
    type: 'number',
    min: 0,
    max: 150,
    step: 5,
    default: 45,
    description: 'Радіус гарантованої видимості навколо гравця у повній темряві'
  },
  {
    key: 'lanternOffMaxDuration',
    category: 'vision',
    label: 'Макс. час вимкненого ліхтаря',
    unit: 'сек',
    type: 'number',
    min: 0.2,
    max: 10.0,
    step: 0.1,
    default: 1.0,
    description: 'Час, протягом якого боєць може пересуватися в режимі стелс із вимкненим світлом'
  },
  {
    key: 'lanternCooldown',
    category: 'vision',
    label: 'Кулдаун повторного вимкнення ліхтаря',
    unit: 'сек',
    type: 'number',
    min: 0.5,
    max: 20.0,
    step: 0.5,
    default: 4.0,
    description: 'Час відновлення механізму ліхтаря перед наступним гасінням'
  },

  // --- Acoustics & Sound Waves ---
  {
    key: 'soundSpeed',
    category: 'acoustics',
    label: 'Швидкість поширення звукової хвилі',
    unit: 'px/s',
    type: 'number',
    min: 100,
    max: 1200,
    step: 25,
    default: 400,
    description: 'Швидкість розбігання кілець звуку по арені крізь туман війни'
  },
  {
    key: 'footstepSoundRadius',
    category: 'acoustics',
    label: 'Радіус звуку кроків',
    unit: 'px',
    type: 'number',
    min: 20,
    max: 300,
    step: 5,
    default: 90,
    description: 'Максимальний радіус акустичної хвилі від звичайних кроків гравця'
  },
  {
    key: 'gunfireSoundRadius',
    category: 'acoustics',
    label: 'Радіус звуку пострілу',
    unit: 'px',
    type: 'number',
    min: 50,
    max: 600,
    step: 10,
    default: 168,
    description: 'Максимальний радіус звукової детонації під час стрільби'
  },
  {
    key: 'reloadSoundRadius',
    category: 'acoustics',
    label: 'Радіус звуку перезарядки',
    unit: 'px',
    type: 'number',
    min: 20,
    max: 400,
    step: 5,
    default: 120,
    description: 'Радіус чутності механічного брязкоту під час перезаряджання'
  },
  {
    key: 'soundWaveDuration',
    category: 'acoustics',
    label: 'Тривалість анімації звукової хвилі',
    unit: 'сек',
    type: 'number',
    min: 0.3,
    max: 3.0,
    step: 0.1,
    default: 1.0,
    description: 'Час загасання візуального кільця звуку на екрані'
  },

  // --- Ballistics & Combat ---
  {
    key: 'projectileSpeed',
    category: 'combat',
    label: 'Базова швидкість куль',
    unit: 'px/s',
    type: 'number',
    min: 500,
    max: 3500,
    step: 50,
    default: 1800,
    description: 'Початкова швидкість польоту стандартного снаряда'
  },
  {
    key: 'projectileLifetime',
    category: 'combat',
    label: 'Макс. тривалість польоту кулі',
    unit: 'сек',
    type: 'number',
    min: 0.3,
    max: 4.0,
    step: 0.1,
    default: 1.2,
    description: 'Час до самознищення снаряда, якщо він не влучив у стіну чи ціль'
  },
  {
    key: 'damageMultiplier',
    category: 'combat',
    label: 'Глобальний множник урону',
    unit: 'x',
    type: 'number',
    min: 0.1,
    max: 5.0,
    step: 0.1,
    default: 1.0,
    description: 'Коефіцієнт усього наносного урону в грі (1.0 = 100%)'
  },
  {
    key: 'bulletSparksCount',
    category: 'combat',
    label: 'Кількість іскор від влучання',
    unit: 'шт',
    type: 'number',
    min: 0,
    max: 30,
    step: 1,
    default: 8,
    description: 'Кількість часток при рикошеті та потраплянні в броню чи стіну'
  },
  {
    key: 'bulletSparksSpeed',
    category: 'combat',
    label: 'Швидкість розльоту іскор',
    unit: 'px/s',
    type: 'number',
    min: 10,
    max: 300,
    step: 10,
    default: 80,
    description: 'Початкова імпульсна швидкість часток іскор'
  },

  // --- AI Bots & Difficulties ---
  {
    key: 'botReactionEasy',
    category: 'bots',
    label: 'Затримка реакції: Рекрут (Легкий)',
    unit: 'сек',
    type: 'number',
    min: 0.1,
    max: 3.0,
    step: 0.05,
    default: 0.85,
    description: 'Час обдумування перед атакою чи поворотом легкого бота'
  },
  {
    key: 'botReactionNormal',
    category: 'bots',
    label: 'Затримка реакції: Ветеран (Звичайний)',
    unit: 'сек',
    type: 'number',
    min: 0.05,
    max: 2.0,
    step: 0.05,
    default: 0.45,
    description: 'Час реакції стандартного бота'
  },
  {
    key: 'botReactionHard',
    category: 'bots',
    label: 'Затримка реакції: Еліта (Важкий)',
    unit: 'сек',
    type: 'number',
    min: 0.02,
    max: 1.0,
    step: 0.02,
    default: 0.22,
    description: 'Час реакції елітного автоматона'
  },
  {
    key: 'botReactionNightmare',
    category: 'bots',
    label: 'Затримка реакції: Титан (Екстрем)',
    unit: 'сек',
    type: 'number',
    min: 0.01,
    max: 0.5,
    step: 0.01,
    default: 0.08,
    description: 'Блискавична реакція кошмарного титана'
  },
  {
    key: 'botAimPrecision',
    category: 'bots',
    label: 'Точність прицілу ботів',
    unit: '%',
    type: 'number',
    min: 10,
    max: 100,
    step: 5,
    default: 85,
    description: 'Базова влучність ведення вогню штучним інтелектом'
  },

  // --- Economy & Match Rewards ---
  {
    key: 'rewardWinXp',
    category: 'economy',
    label: 'Досвід (XP) за перемогу',
    unit: 'XP',
    type: 'number',
    min: 0,
    max: 2000,
    step: 10,
    default: 150,
    description: 'Очки досвіду за тріумф у раунді'
  },
  {
    key: 'rewardLossXp',
    category: 'economy',
    label: 'Досвід (XP) за поразку',
    unit: 'XP',
    type: 'number',
    min: 0,
    max: 1000,
    step: 10,
    default: 50,
    description: 'Очки досвіду за участь при поразці'
  },
  {
    key: 'rewardKillXp',
    category: 'economy',
    label: 'Досвід (XP) за знищення ворога',
    unit: 'XP',
    type: 'number',
    min: 0,
    max: 500,
    step: 5,
    default: 25,
    description: 'Додатковий досвід за кожен здійснений кіл'
  },
  {
    key: 'rewardWinScrap',
    category: 'economy',
    label: 'Латунний брухт за перемогу',
    unit: 'Scrap',
    type: 'number',
    min: 0,
    max: 2000,
    step: 10,
    default: 120,
    description: 'Ресурси на апгрейди за перемогу'
  },
  {
    key: 'rewardLossScrap',
    category: 'economy',
    label: 'Латунний брухт за поразку',
    unit: 'Scrap',
    type: 'number',
    min: 0,
    max: 1000,
    step: 10,
    default: 40,
    description: 'Втішні деталі за участь'
  },
  {
    key: 'rewardKillScrap',
    category: 'economy',
    label: 'Латунний брухт за кіл',
    unit: 'Scrap',
    type: 'number',
    min: 0,
    max: 500,
    step: 5,
    default: 20,
    description: 'Бонусні деталі за кожен фраг'
  },
  {
    key: 'rewardWinCores',
    category: 'economy',
    label: 'Ефірні ядра за перемогу',
    unit: 'Cores',
    type: 'number',
    min: 0,
    max: 20,
    step: 1,
    default: 1,
    description: 'Рідкісні ефірні ядра на відкриття креслень'
  },

  // --- Server & Networking ---
  {
    key: 'serverTickRate',
    category: 'server',
    label: 'Частота симуляції (Tick Rate)',
    unit: 'Hz',
    type: 'number',
    min: 15,
    max: 60,
    step: 5,
    default: 30,
    description: 'Кількість ігрових тіків сервера за секунду (30 Гц за замовчуванням)'
  },
  {
    key: 'defaultTargetKillsFfa',
    category: 'server',
    label: 'Ліміт кілів FFA за замовчуванням',
    unit: 'фрагів',
    type: 'number',
    min: 3,
    max: 50,
    step: 1,
    default: 10,
    description: 'Цільова кількість знищень у режимі FFA Deathmatch'
  },
  {
    key: 'defaultTargetKillsTeam',
    category: 'server',
    label: 'Ліміт кілів Team DM за замовчуванням',
    unit: 'фрагів',
    type: 'number',
    min: 5,
    max: 100,
    step: 5,
    default: 15,
    description: 'Цільова кількість знищень у командному режимі'
  },
  {
    key: 'maxPlayersPerRoom',
    category: 'server',
    label: 'Максимум бійців на арені',
    unit: 'гравців',
    type: 'number',
    min: 2,
    max: 16,
    step: 1,
    default: 8,
    description: 'Гранична місткість однієї кімнати матчу'
  },
  {
    key: 'matchWarmupSeconds',
    category: 'server',
    label: 'Час передстартового відліку',
    unit: 'сек',
    type: 'number',
    min: 0,
    max: 10,
    step: 0.5,
    default: 1.5,
    description: 'Тривалість фази розминки перед початком стрільби'
  }
];

export const GAME_SETTINGS_MAP = new Map(
  GAME_SETTINGS_SCHEMA.map(item => [item.key, item])
);

export function getDefaultGameSettings() {
  const defaults = {};
  for (const item of GAME_SETTINGS_SCHEMA) {
    defaults[item.key] = item.default;
  }
  return defaults;
}

export const GAME_SETTING_PRESETS = {
  standard: {
    id: 'standard',
    name: '⚖️ Стандартний турнір (Standard)',
    description: 'Оригінальний ретельно вивірений баланс для тактичних боїв',
    settings: getDefaultGameSettings()
  },
  high_dynamism: {
    id: 'high_dynamism',
    name: '⚡ Висока динаміка (Fast & Furious)',
    description: 'Підвищена швидкість бігу (+40%), швидкісні кулі та збільшений урон',
    settings: {
      ...getDefaultGameSettings(),
      playerWalkSpeed: 160,
      playerRunSpeed: 300,
      projectileSpeed: 2400,
      damageMultiplier: 1.3,
      staminaDrainRun: 20,
      staminaRecover: 30
    }
  },
  hardcore_darkness: {
    id: 'hardcore_darkness',
    name: '🕯️ Глибокий стелс (Hardcore Darkness)',
    description: 'Вузький промінь ліхтаря (55°), підвищена дальність звуку та довгий стелс',
    settings: {
      ...getDefaultGameSettings(),
      lanternFovDeg: 55,
      proximityRadius: 30,
      footstepSoundRadius: 130,
      gunfireSoundRadius: 240,
      lanternOffMaxDuration: 2.5,
      lanternCooldown: 3.0
    }
  },
  snipers_arena: {
    id: 'snipers_arena',
    name: '🎯 Снайперська дуель (Long Range)',
    description: 'Дальній огляд ліхтаря (600px), надшвидкі кулі та підвищені нагороди за кіли',
    settings: {
      ...getDefaultGameSettings(),
      lanternRange: 600,
      projectileSpeed: 2600,
      rewardKillXp: 50,
      rewardKillScrap: 40
    }
  }
};

/**
 * Validates and sanitizes a settings object against schema definitions.
 * @param {Object} inputSettings
 * @returns {Object} Clean validated settings
 */
export function sanitizeGameSettings(inputSettings = {}) {
  const result = getDefaultGameSettings();
  if (!inputSettings || typeof inputSettings !== 'object') {
    return result;
  }

  for (const item of GAME_SETTINGS_SCHEMA) {
    const val = inputSettings[item.key];
    if (val !== undefined && val !== null) {
      if (item.type === 'number') {
        const num = Number(val);
        if (!isNaN(num)) {
          result[item.key] = Math.max(item.min, Math.min(item.max, num));
        }
      } else if (item.type === 'boolean') {
        result[item.key] = Boolean(val);
      } else {
        result[item.key] = String(val);
      }
    }
  }

  return result;
}
