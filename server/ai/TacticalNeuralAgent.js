/**
 * TacticalNeuralAgent.js
 * Adaptive Behavioral Neural Network for Steampunk Automaton AI.
 * 
 * Features:
 * - 3-layer Policy MLP (12 inputs -> 16 hidden -> 12 hidden -> 6 tactical actions)
 * - Online Imitation Learning: Observes human players' combat maneuvers (strafing, cover seeking, reload evasion)
 * - Predictive Lead Aiming: Anticipates moving targets based on projectile speed
 * - Tactical Cover Assessment: Uses raycasting to identify nearby occluding cover during reloads
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isPointVisible } from '../../shared/RaycastMath.js';
import { TILE_TYPES } from '../../shared/MapSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEIGHTS_FILE = path.join(__dirname, 'neural_bot_weights.json');

// Action enumerations
export const TACTICAL_ACTIONS = {
  STRAFE_LEFT: 0,
  STRAFE_RIGHT: 1,
  TAKE_COVER: 2,
  FLANK_ADVANCE: 3,
  KITE_RETREAT: 4,
  HOLD_AMBUSH: 5
};

export class TacticalNeuralAgent {
  constructor(options = {}) {
    this.learningRate = options.learningRate ?? 0.005;
    this.momentum = options.momentum ?? 0.85;
    this.weightsFile = options.weightsFile || WEIGHTS_FILE;

    // Network Dimensions: 12 -> 16 -> 12 -> 6
    this.inputDim = 12;
    this.h1Dim = 16;
    this.h2Dim = 12;
    this.outputDim = 6;

    // Weights & Biases
    this.W1 = [];
    this.b1 = [];
    this.W2 = [];
    this.b2 = [];
    this.W3 = [];
    this.b3 = [];

    // Momentum velocity buffers for online updates
    this.vW1 = [];
    this.vb1 = [];
    this.vW2 = [];
    this.vb2 = [];
    this.vW3 = [];
    this.vb3 = [];

    this.playerObservationBuffer = [];
    this.replayBuffer = [];
    this.lastAmbushSampleTime = 0;
    this.saveTimer = 0;

    // Cumulative learning metrics
    this.totalUpdatesCount = 0;
    this.totalEpisodesLearned = 0;
    this.actionDistribution = [0, 0, 0, 0, 0, 0];

    this.initWeights();
    this.loadWeights();
  }

  /**
   * Initializes network parameters with He-normal distribution and tactical heuristic priors.
   */
  initWeights() {
    const randn = () => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    const initMatrix = (rows, cols) => {
      const scale = Math.sqrt(2.0 / rows);
      return Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => randn() * scale)
      );
    };

    const initZeros = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(0));
    const initVec = (len, val = 0) => Array(len).fill(val);

    this.W1 = initMatrix(this.inputDim, this.h1Dim);
    this.b1 = initVec(this.h1Dim, 0.05);
    this.W2 = initMatrix(this.h1Dim, this.h2Dim);
    this.b2 = initVec(this.h2Dim, 0.05);
    this.W3 = initMatrix(this.h2Dim, this.outputDim);
    this.b3 = initVec(this.outputDim, 0);

    // Balanced prior biases across tactical maneuvers
    this.b3[TACTICAL_ACTIONS.STRAFE_LEFT] = 0.35;
    this.b3[TACTICAL_ACTIONS.STRAFE_RIGHT] = 0.35;
    this.b3[TACTICAL_ACTIONS.TAKE_COVER] = 0.30;
    this.b3[TACTICAL_ACTIONS.FLANK_ADVANCE] = 0.25;
    this.b3[TACTICAL_ACTIONS.KITE_RETREAT] = 0.20;
    this.b3[TACTICAL_ACTIONS.HOLD_AMBUSH] = 0.15;

    this.vW1 = initZeros(this.inputDim, this.h1Dim);
    this.vb1 = initVec(this.h1Dim, 0);
    this.vW2 = initZeros(this.h1Dim, this.h2Dim);
    this.vb2 = initVec(this.h2Dim, 0);
    this.vW3 = initZeros(this.h2Dim, this.outputDim);
    this.vb3 = initVec(this.outputDim, 0);
  }

  /**
   * Loads persisted weights and cumulative learning metrics if valid.
   */
  loadWeights() {
    try {
      if (fs.existsSync(this.weightsFile)) {
        const raw = fs.readFileSync(this.weightsFile, 'utf8');
        const data = JSON.parse(raw);
        if (data.W1 && data.W2 && data.W3) {
          // Check if weights are not degenerate (e.g. check not all 0 or heavily skewed ambush bias)
          const isAmbushSkewed = data.b3 && data.b3[TACTICAL_ACTIONS.HOLD_AMBUSH] > 4.0;
          const isZeroed = data.W1[0] && data.W1[0].every(w => w === 0);

          if (!isAmbushSkewed && !isZeroed) {
            this.W1 = data.W1;
            this.b1 = data.b1;
            this.W2 = data.W2;
            this.b2 = data.b2;
            this.W3 = data.W3;
            this.b3 = data.b3;
            if (typeof data.totalUpdatesCount === 'number') this.totalUpdatesCount = data.totalUpdatesCount;
            if (typeof data.totalEpisodesLearned === 'number') this.totalEpisodesLearned = data.totalEpisodesLearned;
            if (Array.isArray(data.actionDistribution)) this.actionDistribution = data.actionDistribution;
            return;
          }
        }
      }
    } catch (_) {
      // Fallback silently to initialized weights
    }
    // If not loaded or degenerate, save clean initial state
    this.saveWeights();
  }

  /**
   * Persists weights and cumulative learning progress to JSON storage.
   */
  saveWeights() {
    try {
      this.totalEpisodesLearned++;
      const data = {
        W1: this.W1,
        b1: this.b1,
        W2: this.W2,
        b2: this.b2,
        W3: this.W3,
        b3: this.b3,
        totalUpdatesCount: this.totalUpdatesCount,
        totalEpisodesLearned: this.totalEpisodesLearned,
        actionDistribution: this.actionDistribution,
        savedAt: Date.now()
      };
      fs.writeFileSync(this.weightsFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) {}
  }

  /**
   * Forward pass: computes action logits and probability distribution.
   * @param {number[]} x - 12-dimensional normalized input vector
   * @returns {{ logits: number[], probs: number[], h1: number[], h2: number[] }}
   */
  forward(x) {
    // Hidden Layer 1 (LeakyReLU: slope 0.05 for x < 0)
    const h1 = new Array(this.h1Dim);
    for (let j = 0; j < this.h1Dim; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < this.inputDim; i++) {
        sum += x[i] * this.W1[i][j];
      }
      h1[j] = sum > 0 ? sum : sum * 0.05;
    }

    // Hidden Layer 2 (LeakyReLU)
    const h2 = new Array(this.h2Dim);
    for (let k = 0; k < this.h2Dim; k++) {
      let sum = this.b2[k];
      for (let j = 0; j < this.h1Dim; j++) {
        sum += h1[j] * this.W2[j][k];
      }
      h2[k] = sum > 0 ? sum : sum * 0.05;
    }

    // Output Layer (Logits)
    const logits = new Array(this.outputDim);
    let maxLogit = -Infinity;
    for (let m = 0; m < this.outputDim; m++) {
      let sum = this.b3[m];
      for (let k = 0; k < this.h2Dim; k++) {
        sum += h2[k] * this.W3[k][m];
      }
      logits[m] = sum;
      if (sum > maxLogit) maxLogit = sum;
    }

    // Softmax probabilities
    const exps = logits.map(l => Math.exp(Math.min(10, Math.max(-10, l - maxLogit))));
    const sumExps = exps.reduce((a, b) => a + b, 0) || 1.0;
    const probs = exps.map(e => e / sumExps);

    return { logits, probs, h1, h2 };
  }

  /**
   * Constructs the 12-dimensional sensory input feature vector.
   * @param {Object} entity - Bot or Player
   * @param {Object} target - Combatant target
   * @param {Object} room - Active server Room
   * @returns {number[]} Normalized 12-dimensional vector
   */
  extractFeatures(entity, target, room) {
    const maxRange = entity.range || 420;
    const dx = target.x - entity.x;
    const dy = target.y - entity.y;
    const dist = Math.hypot(dx, dy) || 1;
    const distNorm = Math.min(1.0, dist / maxRange);

    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - (entity.angle || 0);
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const angleDiffNorm = angleDiff / Math.PI; // -1 to 1

    const tSpeed = Math.hypot(target.vx || 0, target.vy || 0);
    const tSpeedNorm = Math.min(1.0, tSpeed / 250);

    const hpRatio = Math.max(0, Math.min(1, (entity.hp || 100) / (entity.maxHp || 100)));
    const ammoRatio = (entity.maxAmmo && entity.maxAmmo > 0) ? (entity.ammo || 0) / entity.maxAmmo : 1.0;
    const isReloading = entity.isReloading ? 1.0 : 0.0;

    // Raycast obstacle detection in 3 cardinal orientations relative to entity
    const segments = room?.geometrySegments || [];
    const checkWall = (angleOffset, distance = 40) => {
      const probeAngle = (entity.angle || 0) + angleOffset;
      const probeTarget = {
        x: entity.x + Math.cos(probeAngle) * distance,
        y: entity.y + Math.sin(probeAngle) * distance
      };
      return isPointVisible({ x: entity.x, y: entity.y }, probeTarget, segments) ? 0.0 : 1.0;
    };

    const hasCoverLeft = checkWall(Math.PI / 2, 45);
    const hasCoverRight = checkWall(-Math.PI / 2, 45);
    const hasCoverBehind = checkWall(Math.PI, 45);

    const enemyFiring = target.isFiring ? 1.0 : 0.0;
    const recentHit = (entity.lastDamageTime && (Date.now() - entity.lastDamageTime < 1200)) ? 1.0 : 0.0;
    const inCloseProximity = dist < 90 ? 1.0 : 0.0;

    return [
      distNorm,
      angleDiffNorm,
      tSpeedNorm,
      hpRatio,
      ammoRatio,
      isReloading,
      hasCoverLeft,
      hasCoverRight,
      hasCoverBehind,
      enemyFiring,
      recentHit,
      inCloseProximity
    ];
  }

  /**
   * Evaluates the policy network for a bot and returns tactical movement decisions.
   * @param {Object} bot
   * @param {Object} target
   * @param {Object} room
   * @param {number} dt
   * @returns {{ action: number, strafeX: number, strafeY: number, leadAngle: number, needsCover: boolean }}
   */
  evaluateBot(bot, target, room, dt = 0.016) {
    if (!target) {
      return { action: TACTICAL_ACTIONS.HOLD_AMBUSH, strafeX: 0, strafeY: 0, leadAngle: bot.angle, needsCover: false };
    }

    const features = this.extractFeatures(bot, target, room);
    const { probs } = this.forward(features);

    // Pick action using weighted argmax / probabilistic sampling
    let chosenAction = 0;
    let maxP = -1;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] > maxP) {
        maxP = probs[i];
        chosenAction = i;
      }
    }

    // Force tactical cover when critically wounded or reloading with zero ammo
    if ((bot.hp <= 30 || (bot.ammo <= 0 && bot.isReloading)) && probs[TACTICAL_ACTIONS.TAKE_COVER] > 0.15) {
      chosenAction = TACTICAL_ACTIONS.TAKE_COVER;
    }

    // Calculate predictive lead aim towards target trajectory
    const leadAngle = this.predictLeadAim(bot, target, bot.weaponSpeed || 1800);

    // Movement direction vectors based on selected tactical action
    let strafeX = 0;
    let strafeY = 0;
    let needsCover = false;

    const perpLeftX = -Math.sin(bot.angle);
    const perpLeftY = Math.cos(bot.angle);
    const forwardX = Math.cos(bot.angle);
    const forwardY = Math.sin(bot.angle);

    switch (chosenAction) {
      case TACTICAL_ACTIONS.STRAFE_LEFT:
        strafeX = perpLeftX;
        strafeY = perpLeftY;
        break;

      case TACTICAL_ACTIONS.STRAFE_RIGHT:
        strafeX = -perpLeftX;
        strafeY = -perpLeftY;
        break;

      case TACTICAL_ACTIONS.TAKE_COVER:
        needsCover = true;
        // Move backward and laterally towards nearest cover
        strafeX = -forwardX * 0.7 + (features[6] > 0.5 ? perpLeftX : -perpLeftX) * 0.7;
        strafeY = -forwardY * 0.7 + (features[6] > 0.5 ? perpLeftY : -perpLeftY) * 0.7;
        break;

      case TACTICAL_ACTIONS.FLANK_ADVANCE:
        // Arc forward and sideways
        strafeX = forwardX * 0.6 + perpLeftX * 0.8;
        strafeY = forwardY * 0.6 + perpLeftY * 0.8;
        break;

      case TACTICAL_ACTIONS.KITE_RETREAT:
        // Backpedal while firing
        strafeX = -forwardX;
        strafeY = -forwardY;
        break;

      case TACTICAL_ACTIONS.HOLD_AMBUSH:
      default:
        strafeX = 0;
        strafeY = 0;
        break;
    }

    return {
      action: chosenAction,
      strafeX,
      strafeY,
      leadAngle,
      needsCover
    };
  }

  /**
   * Calculates ballistic lead prediction for projectile trajectory.
   * @param {Object} shooter - Entity firing
   * @param {Object} target - Target entity
   * @param {number} projSpeed - Speed of projectile in px/s
   * @returns {number} Aim angle in radians
   */
  predictLeadAim(shooter, target, projSpeed = 1800) {
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 10 || projSpeed <= 0) {
      return Math.atan2(dy, dx);
    }

    // Time of flight
    const t = dist / projSpeed;

    // Approximate target velocity from render displacement or velocity properties
    const vx = target.vx ?? ((target.x - (target.lastX ?? target.x)) / 0.033) ?? 0;
    const vy = target.vy ?? ((target.y - (target.lastY ?? target.y)) / 0.033) ?? 0;

    // Predictive lead with safe clamping
    const leadFactor = 0.85; // Human-like reaction lead
    const predX = target.x + vx * t * leadFactor;
    const predY = target.y + vy * t * leadFactor;

    return Math.atan2(predY - shooter.y, predX - shooter.x);
  }

  /**
   * Online Imitation Learning: Observes human players and records tactical behaviors.
   * Trains the neural policy using Behavioral Cloning.
   * @param {Object} humanPlayer
   * @param {Object} room
   * @param {number} dtSec
   */
  observePlayer(humanPlayer, room, dtSec = 0.033) {
    if (!humanPlayer || !humanPlayer.isAlive || humanPlayer.isBot) return;

    // Find nearest opponent combatant visible to this human player
    let nearestOpponent = null;
    let minOppDist = Infinity;
    const allCombatants = [...(room.players?.values() || []), ...(room.bots?.values() || [])];

    for (const c of allCombatants) {
      if (c.id === humanPlayer.id || !c.isAlive) continue;
      if (humanPlayer.team && c.team && humanPlayer.team === c.team) continue;
      const d = Math.hypot(c.x - humanPlayer.x, c.y - humanPlayer.y);
      if (d < minOppDist && d < (humanPlayer.range || 450)) {
        minOppDist = d;
        nearestOpponent = c;
      }
    }

    if (!nearestOpponent) return;

    // Determine the action the human player performed
    const hvx = humanPlayer.vx ?? ((humanPlayer.x - (humanPlayer.lastX ?? humanPlayer.x)) / dtSec) ?? 0;
    const hvy = humanPlayer.vy ?? ((humanPlayer.y - (humanPlayer.lastY ?? humanPlayer.y)) / dtSec) ?? 0;
    const hSpeed = Math.hypot(hvx, hvy);

    let targetAction = null;

    if (humanPlayer.isReloading && hSpeed > 30) {
      targetAction = TACTICAL_ACTIONS.TAKE_COVER;
    } else if (hSpeed > 20) {
      // Evaluate lateral strafing relative to target line
      const toOppAngle = Math.atan2(nearestOpponent.y - humanPlayer.y, nearestOpponent.x - humanPlayer.x);
      const moveAngle = Math.atan2(hvy, hvx);
      let angleDelta = moveAngle - toOppAngle;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;

      if (angleDelta > 0.35 && angleDelta < 2.8) {
        targetAction = TACTICAL_ACTIONS.STRAFE_LEFT;
      } else if (angleDelta < -0.35 && angleDelta > -2.8) {
        targetAction = TACTICAL_ACTIONS.STRAFE_RIGHT;
      } else if (Math.abs(angleDelta) >= 2.8) {
        targetAction = TACTICAL_ACTIONS.KITE_RETREAT;
      } else {
        targetAction = TACTICAL_ACTIONS.FLANK_ADVANCE;
      }
    } else {
      // Stationary: only sample HOLD_AMBUSH if actively engaged (firing or close proximity)
      // Throttled to avoid overwhelming the model with idle stationary frames
      const now = Date.now();
      const isEngaged = humanPlayer.isFiring || minOppDist < 200;
      if (isEngaged && (now - this.lastAmbushSampleTime > 1200)) {
        targetAction = TACTICAL_ACTIONS.HOLD_AMBUSH;
        this.lastAmbushSampleTime = now;
      }
    }

    if (targetAction === null) return;

    // Extract human state vector
    const x = this.extractFeatures(humanPlayer, nearestOpponent, room);

    // Record into experience replay buffer
    this.replayBuffer.push({ x, action: targetAction });
    if (this.replayBuffer.length > 150) {
      this.replayBuffer.shift();
    }

    // Sample from replay buffer to perform balanced gradient step
    let sample = { x, action: targetAction };
    if (this.replayBuffer.length > 10 && Math.random() < 0.6) {
      const minActionCount = Math.min(...this.actionDistribution);
      const candidates = this.replayBuffer.filter(e => this.actionDistribution[e.action] <= minActionCount + 10);
      if (candidates.length > 0) {
        sample = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        sample = this.replayBuffer[Math.floor(Math.random() * this.replayBuffer.length)];
      }
    }

    // Perform an online behavioral cloning gradient step
    this.trainStep(sample.x, sample.action);
    this.actionDistribution[sample.action]++;
    this.totalUpdatesCount++;

    // Periodically save updated neural weights (every 45s)
    this.saveTimer += dtSec;
    if (this.saveTimer > 45) {
      this.saveTimer = 0;
      this.saveWeights();
    }
  }

  /**
   * Performs an online gradient descent update on policy weights given state and target action.
   * @param {number[]} x - Input vector
   * @param {number} targetAction - Action to reinforce (0..5)
   */
  trainStep(x, targetAction) {
    const { probs, h1, h2 } = this.forward(x);

    // Cross-entropy loss gradient: dL/dLogits = probs - one_hot(targetAction)
    const dLogits = new Array(this.outputDim);
    for (let m = 0; m < this.outputDim; m++) {
      dLogits[m] = probs[m] - (m === targetAction ? 1.0 : 0.0);
    }

    // Backprop to Layer 3
    const dH2 = new Array(this.h2Dim).fill(0);
    for (let m = 0; m < this.outputDim; m++) {
      const grad = dLogits[m];
      this.vb3[m] = this.momentum * this.vb3[m] - this.learningRate * grad;
      this.b3[m] += this.vb3[m];

      for (let k = 0; k < this.h2Dim; k++) {
        dH2[k] += grad * this.W3[k][m];
        const wGrad = grad * h2[k];
        this.vW3[k][m] = this.momentum * this.vW3[k][m] - this.learningRate * wGrad;
        this.W3[k][m] += this.vW3[k][m];
      }
    }

    // Backprop to Layer 2 (LeakyReLU derivative: 1.0 if h2 > 0 else 0.05)
    const dH1 = new Array(this.h1Dim).fill(0);
    for (let k = 0; k < this.h2Dim; k++) {
      const actGrad = dH2[k] * (h2[k] > 0 ? 1.0 : 0.05);
      this.vb2[k] = this.momentum * this.vb2[k] - this.learningRate * actGrad;
      this.b2[k] += this.vb2[k];

      for (let j = 0; j < this.h1Dim; j++) {
        dH1[j] += actGrad * this.W2[j][k];
        const wGrad = actGrad * h1[j];
        this.vW2[j][k] = this.momentum * this.vW2[j][k] - this.learningRate * wGrad;
        this.W2[j][k] += this.vW2[j][k];
      }
    }

    // Backprop to Layer 1
    for (let j = 0; j < this.h1Dim; j++) {
      const actGrad = dH1[j] * (h1[j] > 0 ? 1.0 : 0.05);
      this.vb1[j] = this.momentum * this.vb1[j] - this.learningRate * actGrad;
      this.b1[j] += this.vb1[j];

      for (let i = 0; i < this.inputDim; i++) {
        const wGrad = actGrad * x[i];
        this.vW1[i][j] = this.momentum * this.vW1[i][j] - this.learningRate * wGrad;
        this.W1[i][j] += this.vW1[i][j];
      }
    }
  }
}

export const tacticalNeuralAgent = new TacticalNeuralAgent();
export default tacticalNeuralAgent;
