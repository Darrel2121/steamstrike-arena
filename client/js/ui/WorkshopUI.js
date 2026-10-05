/**
 * WorkshopUI.js
 * Controller for the Steampunk Workshop and Weapon Armory.
 * Renders brass dial canvases, handles upgrade interactions, tab toggles, and weapon equipping.
 */

import { UPGRADE_TIERS } from '../ProgressionManager.js';
import { WEAPON_DEFINITIONS, MAX_UPGRADE_TIER, WEAPON_CAPACITY_STEPS } from '../../../shared/ProgressionSchema.js';

export const UKRAINIAN_RANKS = {
  1: 'Ранг 1: Учень-механік',
  2: 'Ранг 2: Котельний підмайстер',
  3: 'Ранг 3: Стрілець-налагоджувач',
  4: 'Ранг 4: Паровий технік',
  5: 'Ранг 5: Майстер шестерень',
  6: 'Ранг 6: Інженер-балістик',
  7: 'Ранг 7: Ефірний алхімік',
  8: 'Ранг 8: Командор гвардії',
  9: 'Ранг 9: Обер-механікус арени',
  10: 'Ранг 10: Легендарний паровий титан'
};

export class WorkshopUI {
  /**
   * @param {Object} progressionManager - Instance of ProgressionManager
   * @param {Object} [options]
   */
  constructor(progressionManager, options = {}) {
    this.prog = progressionManager;
    this.options = options;
    this.activeTab = 'character'; // 'character' | 'weapons'
    this.selectedWeaponId = 'revolver';

    this.bindDom();
    this.attachEvents();

    if (this.prog) {
      this.prog.on('profileUpdated', () => this.render());
    }
  }

  isGuest() {
    const prof = this.prog?.getProfile();
    return !prof || prof.isGuest !== false;
  }

  promptRegistration(actionName = 'покращувати арсенал') {
    if (typeof this.options?.onRequireAuth === 'function') {
      this.options.onRequireAuth(actionName);
    } else if (this.options?.authModal) {
      this.options.authModal.open();
    } else {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { actionName } }));
    }
  }

  bindDom() {
    this.dom = {
      container: document.getElementById('view-workshop'),
      rankBadge: document.getElementById('workshopRankBadge'),
      rankTitle: document.getElementById('workshopRankTitle'),
      xpFill: document.getElementById('workshopXpFill'),
      xpText: document.getElementById('workshopXpText'),
      scrapVal: document.getElementById('workshopScrapVal'),
      coreVal: document.getElementById('workshopCoreVal'),

      workshopGuestNotice: document.getElementById('workshopGuestNotice'),
      btnWorkshopAuthPrompt: document.getElementById('btnWorkshopAuthPrompt'),

      tabBtns: document.querySelectorAll('.workshop-tab-btn'),
      tabCharacter: document.getElementById('tabContentCharacter'),
      tabWeapons: document.getElementById('tabContentWeapons'),

      // Alchemical Smelter
      btnTransmuteScrap: document.getElementById('btnTransmuteScrap'),
      smelterScrapStatus: document.getElementById('smelterScrapStatus'),

      // Dial Canvases
      dialHealth: document.getElementById('dialHealth'),
      dialSpeed: document.getElementById('dialSpeed'),
      dialLantern: document.getElementById('dialLantern'),

      // Stat Readouts
      tierLabelHealth: document.getElementById('tierLabelHealth'),
      valCurrentHp: document.getElementById('valCurrentHp'),
      valNextHp: document.getElementById('valNextHp'),
      costHealth: document.getElementById('costHealth'),
      btnUpgradeHealth: document.getElementById('btnUpgradeHealth'),

      tierLabelSpeed: document.getElementById('tierLabelSpeed'),
      valCurrentSpeed: document.getElementById('valCurrentSpeed'),
      valNextSpeed: document.getElementById('valNextSpeed'),
      costSpeed: document.getElementById('costSpeed'),
      btnUpgradeSpeed: document.getElementById('btnUpgradeSpeed'),

      tierLabelLantern: document.getElementById('tierLabelLantern'),
      valCurrentLantern: document.getElementById('valCurrentLantern'),
      valNextLantern: document.getElementById('valNextLantern'),
      costLantern: document.getElementById('costLantern'),
      btnUpgradeLantern: document.getElementById('btnUpgradeLantern'),

      // Armory
      armoryWeaponList: document.getElementById('armoryWeaponList'),
      workbenchWeaponName: document.getElementById('workbenchWeaponName'),
      workbenchWeaponDesc: document.getElementById('workbenchWeaponDesc'),
      workbenchWeaponStatusBadge: document.getElementById('workbenchWeaponStatusBadge'),
      btnEquipWeapon: document.getElementById('btnEquipWeapon'),
      btnUnlockWeapon: document.getElementById('btnUnlockWeapon')
    };
  }

  attachEvents() {
    // Tab switching
    this.dom.tabBtns?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Guest Auth Banner Prompt Button
    if (this.dom.btnWorkshopAuthPrompt) {
      this.dom.btnWorkshopAuthPrompt.addEventListener('click', () => {
        this.promptRegistration();
      });
    }

    // Alchemical Smelter Transmutation
    this.dom.btnTransmuteScrap?.addEventListener('click', async () => {
      if (this.isGuest()) {
        this.promptRegistration('переплавляти ресурси у плавильні');
        return;
      }
      if (!this.prog.canTransmuteScrap(1)) {
        return;
      }
      const btn = this.dom.btnTransmuteScrap;
      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span>⚙️</span> Плавимо...';
      try {
        await this.prog.transmuteScrap(1);
      } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });

    // Character Upgrades (Gated for registered Google accounts)
    this.dom.btnUpgradeHealth?.addEventListener('click', () => {
      if (this.isGuest()) {
        this.promptRegistration('покращити міцність котла (HP)');
        return;
      }
      this.prog.upgradeCharacter('maxHp');
    });
    this.dom.btnUpgradeSpeed?.addEventListener('click', () => {
      if (this.isGuest()) {
        this.promptRegistration('покращити тиск поршнів (Швидкість)');
        return;
      }
      this.prog.upgradeCharacter('speed');
    });
    this.dom.btnUpgradeLantern?.addEventListener('click', () => {
      if (this.isGuest()) {
        this.promptRegistration('покращити лінзи ліхтаря (Огляд)');
        return;
      }
      this.prog.upgradeCharacter('lantern');
    });

    // Weapon Actions
    this.dom.btnEquipWeapon?.addEventListener('click', () => {
      this.prog.setEquippedWeapon(this.selectedWeaponId);
    });
    this.dom.btnUnlockWeapon?.addEventListener('click', () => {
      if (this.isGuest()) {
        this.promptRegistration('розблокувати нове креслення зброї');
        return;
      }
      this.prog.unlockWeapon(this.selectedWeaponId);
    });

    // Weapon Upgrade Track Delegator (Gated for registered Google accounts)
    document.getElementById('tabContentWeapons')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-track-upgrade');
      if (btn) {
        if (this.isGuest()) {
          this.promptRegistration('покращити характеристики зброї');
          return;
        }
        const track = btn.dataset.track || btn.closest('.upgrade-track')?.dataset.track;
        if (track) {
          this.prog.upgradeWeapon(this.selectedWeaponId, track);
        }
      }
    });
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    this.dom.tabBtns?.forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
    if (this.dom.tabCharacter) this.dom.tabCharacter.classList.toggle('active', tabName === 'character');
    if (this.dom.tabWeapons) this.dom.tabWeapons.classList.toggle('active', tabName === 'weapons');
    this.render();
  }

  render() {
    const profile = this.prog.getProfile();
    if (!profile) return;

    const isGuest = this.isGuest();
    if (this.dom.workshopGuestNotice) {
      this.dom.workshopGuestNotice.style.display = isGuest ? 'flex' : 'none';
    }

    // 1. Render Header Gauges
    if (this.dom.rankBadge) this.dom.rankBadge.textContent = this.toRoman(profile.level);
    if (this.dom.rankTitle) this.dom.rankTitle.textContent = UKRAINIAN_RANKS[profile.level] || `Ранг ${profile.level}: Ветеран арени`;
    const xpRequired = profile.xpToNextLevel || 100;
    if (this.dom.xpText) this.dom.xpText.textContent = `${profile.xp} / ${xpRequired} XP`;
    if (this.dom.xpFill) {
      const pct = Math.min(100, Math.round(((profile.xp % xpRequired) / xpRequired) * 100));
      this.dom.xpFill.style.width = `${pct}%`;
    }
    if (this.dom.scrapVal) this.dom.scrapVal.textContent = profile.currency?.scrap ?? 0;
    if (this.dom.coreVal) this.dom.coreVal.textContent = profile.currency?.cores ?? 0;

    // Render Alchemical Smelter
    if (this.dom.btnTransmuteScrap) {
      const currentScrap = profile.currency?.scrap ?? 0;
      const canTransmute = currentScrap >= 500;
      if (isGuest) {
        this.dom.btnTransmuteScrap.disabled = false;
        this.dom.btnTransmuteScrap.innerHTML = '<span>🔒</span> Увійти для виплавки';
      } else {
        this.dom.btnTransmuteScrap.disabled = !canTransmute;
        this.dom.btnTransmuteScrap.innerHTML = '<span>⚗️</span> Переплавити (+1 💎)';
      }
      if (this.dom.smelterScrapStatus) {
        this.dom.smelterScrapStatus.innerHTML = canTransmute
          ? `<span style="color: var(--color-status-success); font-weight: bold;">Готово до виплавки (${currentScrap} / 500 ⚙)</span>`
          : `<span>Потрібно ще ${Math.max(0, 500 - currentScrap)} ⚙ брухту</span>`;
      }
    }

    // 2. Render Character Foundry
    this.renderCharacterFoundry(profile);

    // 3. Render Weapon Armory
    this.renderWeaponArmory(profile);
  }

  renderCharacterFoundry(profile) {
    const cStats = profile.characterStats || {};
    const isGuest = this.isGuest();

    // HP Dial (Boiler)
    const hpLvl = cStats.healthTier ?? cStats.maxHpLevel ?? 0;
    this.drawBrassDial(this.dom.dialHealth, hpLvl, MAX_UPGRADE_TIER, '#2ec4b6', 'HP');
    if (this.dom.tierLabelHealth) this.dom.tierLabelHealth.textContent = `Рівень ${hpLvl} / ${MAX_UPGRADE_TIER}`;
    if (this.dom.valCurrentHp) this.dom.valCurrentHp.textContent = `${100 + hpLvl * 5} HP`;
    if (this.dom.valNextHp) this.dom.valNextHp.textContent = hpLvl < MAX_UPGRADE_TIER ? `${105 + hpLvl * 5} HP` : 'МАКС';
    if (this.dom.costHealth) {
      if (hpLvl < MAX_UPGRADE_TIER) {
        const c = UPGRADE_TIERS.character.maxHp.costs[hpLvl];
        this.dom.costHealth.textContent = `Вартість: ${c.scrap} ⚙${c.cores > 0 ? ` + ${c.cores} 💎` : ''}`;
      } else {
        this.dom.costHealth.textContent = 'Повністю посилено';
      }
    }
    if (this.dom.btnUpgradeHealth) {
      if (isGuest && hpLvl < MAX_UPGRADE_TIER) {
        this.dom.btnUpgradeHealth.disabled = false;
        this.dom.btnUpgradeHealth.textContent = '🔒 Увійти для покращення';
      } else {
        this.dom.btnUpgradeHealth.disabled = !this.prog.canUpgradeCharacter('maxHp');
        this.dom.btnUpgradeHealth.textContent = 'Посилити котел';
      }
    }

    // Speed Dial (Pistons)
    const spdLvl = cStats.speedTier ?? cStats.speedLevel ?? 0;
    this.drawBrassDial(this.dom.dialSpeed, spdLvl, MAX_UPGRADE_TIER, '#ffcf48', 'SPD');
    if (this.dom.tierLabelSpeed) this.dom.tierLabelSpeed.textContent = `Рівень ${spdLvl} / ${MAX_UPGRADE_TIER}`;
    if (this.dom.valCurrentSpeed) this.dom.valCurrentSpeed.textContent = `${180 + spdLvl * 4} px/с`;
    if (this.dom.valNextSpeed) this.dom.valNextSpeed.textContent = spdLvl < MAX_UPGRADE_TIER ? `${184 + spdLvl * 4} px/с` : 'МАКС';
    if (this.dom.costSpeed) {
      if (spdLvl < MAX_UPGRADE_TIER) {
        const c = UPGRADE_TIERS.character.speed.costs[spdLvl];
        this.dom.costSpeed.textContent = `Вартість: ${c.scrap} ⚙${c.cores > 0 ? ` + ${c.cores} 💎` : ''}`;
      } else {
        this.dom.costSpeed.textContent = 'Повністю відкалібровано';
      }
    }
    if (this.dom.btnUpgradeSpeed) {
      if (isGuest && spdLvl < MAX_UPGRADE_TIER) {
        this.dom.btnUpgradeSpeed.disabled = false;
        this.dom.btnUpgradeSpeed.textContent = '🔒 Увійти для покращення';
      } else {
        this.dom.btnUpgradeSpeed.disabled = !this.prog.canUpgradeCharacter('speed');
        this.dom.btnUpgradeSpeed.textContent = 'Калібрувати поршні';
      }
    }

    // Lantern Dial (Filament)
    const lanLvl = cStats.lanternTier ?? cStats.lanternLevel ?? 0;
    this.drawBrassDial(this.dom.dialLantern, lanLvl, MAX_UPGRADE_TIER, '#ffaa2b', 'LAN');
    if (this.dom.tierLabelLantern) this.dom.tierLabelLantern.textContent = `Рівень ${lanLvl} / ${MAX_UPGRADE_TIER}`;
    if (this.dom.valCurrentLantern) this.dom.valCurrentLantern.textContent = `${420 + lanLvl * 15} px`;
    if (this.dom.valNextLantern) this.dom.valNextLantern.textContent = lanLvl < MAX_UPGRADE_TIER ? `${435 + lanLvl * 15} px` : 'МАКС';
    if (this.dom.costLantern) {
      if (lanLvl < MAX_UPGRADE_TIER) {
        const c = UPGRADE_TIERS.character.lantern.costs[lanLvl];
        this.dom.costLantern.textContent = `Вартість: ${c.scrap} ⚙${c.cores > 0 ? ` + ${c.cores} 💎` : ''}`;
      } else {
        this.dom.costLantern.textContent = 'Максимальна яскравість';
      }
    }
    if (this.dom.btnUpgradeLantern) {
      if (isGuest && lanLvl < MAX_UPGRADE_TIER) {
        this.dom.btnUpgradeLantern.disabled = false;
        this.dom.btnUpgradeLantern.textContent = '🔒 Увійти для покращення';
      } else {
        this.dom.btnUpgradeLantern.disabled = !this.prog.canUpgradeCharacter('lantern');
        this.dom.btnUpgradeLantern.textContent = 'Полірувати лінзи';
      }
    }
  }

  drawBrassDial(canvas, currentTier, maxTier = 5, glowColor = '#ffcf48', centerText = '') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 48;

    ctx.clearRect(0, 0, w, h);

    // Bezel
    ctx.strokeStyle = '#846313';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Notches (5 discrete cog segments)
    const arcStep = (Math.PI * 1.5) / maxTier;
    const startAngle = Math.PI * 0.75;

    for (let i = 0; i < maxTier; i++) {
      const a1 = startAngle + i * arcStep;
      const a2 = a1 + arcStep * 0.8;
      const isActive = i < currentTier;

      ctx.strokeStyle = isActive ? glowColor : '#22262d';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 6, a1, a2);
      ctx.stroke();
    }

    // Center Hub
    ctx.fillStyle = '#161920';
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c59b27';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center Text
    ctx.fillStyle = '#ffcf48';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(centerText, cx, cy);
  }

  renderWeaponArmory(profile) {
    if (!this.dom.armoryWeaponList) return;

    // Render Left Weapon Roster (All 8 Steampunk Weapons)
    this.dom.armoryWeaponList.innerHTML = '';
    const weapons = [
      'revolver',
      'steam_carbine',
      'blunderbuss',
      'needle_gun',
      'tesla_rifle',
      'steam_mortar',
      'aether_flamethrower',
      'gatling_cannon'
    ];

    weapons.forEach(wId => {
      const def = WEAPON_DEFINITIONS[wId];
      if (!def) return;
      const isUnlocked = profile.weapons?.[wId]?.unlocked;
      const isEquipped = profile.equippedWeapon === wId;
      const isSelected = this.selectedWeaponId === wId;

      const btn = document.createElement('div');
      btn.className = `weapon-roster-card ${isSelected ? 'selected' : ''} ${isEquipped ? 'equipped' : ''}`;
      btn.innerHTML = `
        <div class="roster-weapon-header">
          <span class="weapon-name">${def.name}</span>
          ${isEquipped ? '<span class="equipped-badge">СПОРЯДЖЕНО</span>' : (!isUnlocked ? '<span class="locked-badge">🔒</span>' : '')}
        </div>
      `;
      btn.addEventListener('click', () => {
        this.selectedWeaponId = wId;
        this.render();
      });
      this.dom.armoryWeaponList.appendChild(btn);
    });

    // Render Right Workbench Detail
    const curDef = WEAPON_DEFINITIONS[this.selectedWeaponId] || WEAPON_DEFINITIONS.revolver;
    const curData = this.prog.getCalculatedWeaponStats(this.selectedWeaponId);
    const isUnlocked = profile.weapons?.[this.selectedWeaponId]?.unlocked;
    const isEquipped = profile.equippedWeapon === this.selectedWeaponId;

    if (this.dom.workbenchWeaponName) this.dom.workbenchWeaponName.textContent = curDef.name;
    if (this.dom.workbenchWeaponDesc) this.dom.workbenchWeaponDesc.textContent = curDef.description;

    if (this.dom.btnEquipWeapon) {
      this.dom.btnEquipWeapon.style.display = isUnlocked ? 'inline-flex' : 'none';
      this.dom.btnEquipWeapon.textContent = isEquipped ? '★ Споряджено для бою' : '⚔ Спорядити для бою';
      this.dom.btnEquipWeapon.disabled = isEquipped;
    }

    if (this.dom.btnUnlockWeapon) {
      if (!isUnlocked) {
        const cost = UPGRADE_TIERS.unlockCosts[this.selectedWeaponId] || { scrap: 300, cores: 1 };
        this.dom.btnUnlockWeapon.style.display = 'inline-flex';
        if (this.isGuest()) {
          this.dom.btnUnlockWeapon.textContent = `🔒 Увійти для розблокування (${cost.scrap} ⚙ + ${cost.cores} 💎)`;
          this.dom.btnUnlockWeapon.disabled = false;
        } else {
          this.dom.btnUnlockWeapon.textContent = `🔓 Розблокувати креслення (${cost.scrap} ⚙ + ${cost.cores} 💎)`;
          this.dom.btnUnlockWeapon.disabled = !this.prog.canUnlockWeapon(this.selectedWeaponId);
        }
      } else {
        this.dom.btnUnlockWeapon.style.display = 'none';
      }
    }

    // Render 4 Tracks
    this.renderTrack('damage', curData.damage, `${curDef.damage} баз.`, profile);
    this.renderTrack('fireRate', curData.fireRate + '/с', `${curDef.fireRate}/с баз.`, profile);
    this.renderTrack('reload', curData.reload + 'с', `${curDef.reload}с баз.`, profile);
    this.renderTrack('capacity', curData.magazine + ' наб.', `${curDef.magazine} наб. баз.`, profile);
  }

  renderTrack(trackName, currentValText, baseText, profile) {
    const trackEl = document.querySelector(`.upgrade-track[data-track="${trackName}"]`);
    if (!trackEl) return;

    const w = profile.weapons?.[this.selectedWeaponId];
    const isUnlocked = w?.unlocked;
    const lvl = w?.[`${trackName}Tier`] ?? w?.[`${trackName}Level`] ?? 0;
    const cfg = UPGRADE_TIERS.weapons[trackName];

    let bonusText = baseText;
    if (lvl > 0) {
      if (trackName === 'damage') {
        bonusText = `+${lvl * 8}%`;
      } else if (trackName === 'fireRate') {
        bonusText = `+${lvl * 10}%`;
      } else if (trackName === 'reload') {
        bonusText = `-${lvl * 10}%`;
      } else if (trackName === 'capacity') {
        const step = WEAPON_CAPACITY_STEPS?.[this.selectedWeaponId] || 1;
        bonusText = `+${lvl * step} наб.`;
      } else {
        bonusText = `+${lvl * 10}%`;
      }
    }

    const valEl = trackEl.querySelector('.track-val');
    if (valEl) valEl.textContent = `${currentValText} (${lvl > 0 ? bonusText : baseText})`;

    const pipsEl = trackEl.querySelector('.track-pips');
    if (pipsEl) {
      pipsEl.innerHTML = '';
      for (let i = 0; i < MAX_UPGRADE_TIER; i++) {
        const pip = document.createElement('span');
        pip.className = `track-pip ${i < lvl ? 'active' : ''}`;
        pipsEl.appendChild(pip);
      }
    }

    const costEl = trackEl.querySelector('.track-cost');
    const btn = trackEl.querySelector('.btn-track-upgrade');

    if (costEl) {
      if (lvl < MAX_UPGRADE_TIER && cfg.costs[lvl]) {
        const c = cfg.costs[lvl];
        costEl.textContent = `${c.scrap} ⚙${c.cores > 0 ? ` + ${c.cores} 💎` : ''}`;
      } else {
        costEl.textContent = 'МАКС';
      }
    }
    if (btn) {
      if (this.isGuest() && isUnlocked && lvl < MAX_UPGRADE_TIER) {
        btn.disabled = false;
        btn.textContent = '🔒 Увійти';
      } else {
        btn.disabled = !isUnlocked || !this.prog.canUpgradeWeapon(this.selectedWeaponId, trackName);
        btn.textContent = 'Покращити';
      }
    }
  }

  toRoman(num) {
    const lookup = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X' };
    return lookup[num] || String(num);
  }
}

export default WorkshopUI;
