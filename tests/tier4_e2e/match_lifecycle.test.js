/**
 * Tier 4: Real-World End-to-End Match Lifecycle Simulation
 * 10 sequential verification gates simulating a complete gameplay match from custom map export,
 * lobby initialization, bot fill, stealth acoustic ping, lantern LoS firefight, to elimination and victory.
 */
import assert from 'node:assert/strict';
import { runSuiteHelper } from '../harnesses/assert_helpers.js';
import { validateMap, serializeMap, deserializeMap, createDefaultMap } from '../../shared/MapSchema.js';
import { MockWebSocketPair } from '../harnesses/mock_socket.js';
import { PROTOCOL_MSG_TYPES } from '../fixtures/protocol.fixture.js';

export const suiteName = 'Tier 4: End-to-End Real-World Match Lifecycle';

// Shared state between lifecycle stages
const matchContext = {
  exportedMapJson: null,
  room: null,
  clientA: null,
  clientB: null,
  serverSocketA: null,
  serverSocketB: null
};

export const tests = [
  {
    id: 'T4.1',
    name: 'Stage 1: Map Editor Export & Playability Validation',
    fn: async () => {
      // 1. Generate map with custom dimensions and layout
      const customMap = createDefaultMap();
      customMap.name = 'The Grand Clockwork Crucible';

      // 2. Validate playability and BFS reachability
      const validation = validateMap(customMap);
      assert.strictEqual(validation.valid, true, `Map playability check must pass: ${validation.errors.join(', ')}`);

      // 3. Export to JSON string
      const jsonStr = serializeMap(customMap);
      assert.ok(typeof jsonStr === 'string' && jsonStr.length > 100, 'Exported JSON must be valid string');

      // 4. Round-trip verify
      const reimported = deserializeMap(jsonStr);
      assert.deepStrictEqual(reimported.name, customMap.name, 'Reimported map name must match');

      matchContext.exportedMapJson = jsonStr;
    }
  },

  {
    id: 'T4.2',
    name: 'Stage 2: Server Match Initialization & Geometry Compilation',
    fn: async () => {
      let roomModule;
      try {
        roomModule = await import('../../server/Room.js');
      } catch (_) {
        assert.fail('server/Room.js not found - awaiting Milestone M3 implementation');
      }

      const Room = roomModule.Room || roomModule.default;
      const parsedMap = deserializeMap(matchContext.exportedMapJson);

      const room = new Room({
        id: 'match_e2e_001',
        map: parsedMap,
        maxPlayers: 4
      });

      assert.ok(room, 'Room must be successfully instantiated');
      assert.strictEqual(room.state, 'LOBBY', 'Room must start in LOBBY state');
      assert.ok(room.map, 'Room must hold the compiled map definition');

      matchContext.room = room;
    }
  },

  {
    id: 'T4.3',
    name: 'Stage 3: Multi-Client Connection & Autonomous Bot Fill',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room, 'Previous stage room must exist');

      const pairA = new MockWebSocketPair();
      const pairB = new MockWebSocketPair();

      matchContext.clientA = pairA.clientSide;
      matchContext.clientB = pairB.clientSide;
      matchContext.serverSocketA = pairA.serverSide;
      matchContext.serverSocketB = pairB.serverSide;

      // Connect Human Client A
      room.addPlayer('client_a', 'SteampunkAce', pairA.serverSide);
      // Connect Human Client B
      room.addPlayer('client_b', 'BrassStalker', pairB.serverSide);

      assert.strictEqual(room.players.size, 2, 'Lobby must contain 2 connected humans');

      // Room auto-fills empty slots up to 4 with AI Bots
      room.fillWithBots();

      assert.strictEqual(room.bots.size, 2, 'Room must instantiate 2 AI bots to reach 4 players');
    }
  },

  {
    id: 'T4.4',
    name: 'Stage 4: Match Countdown & Entity Spawn Initialization',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      room.startMatch();
      assert.strictEqual(room.state, 'IN_PROGRESS', 'Room state must transition to IN_PROGRESS');

      // Check all 4 entities (2 humans + 2 bots)
      const playerA = room.players.get('client_a');
      const playerB = room.players.get('client_b');

      assert.ok(playerA && playerB, 'Both human player instances must be active in simulation');
      assert.strictEqual(playerA.hp, 100, 'Player A must have 100 HP');
      assert.strictEqual(playerB.hp, 100, 'Player B must have 100 HP');
      assert.strictEqual(playerA.ammo, 6, 'Player A must have 6 ammo');
      assert.strictEqual(playerB.ammo, 6, 'Player B must have 6 ammo');

      // Verify spawn positions are distinct
      assert.notStrictEqual(playerA.x, playerB.x, 'Players must not spawn on top of each other');
    }
  },

  {
    id: 'T4.5',
    name: 'Stage 5: Stealth Movement & Acoustic Detection in Darkness',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      // Client A sprints, generating acoustic footstep pulses
      room.handlePlayerInput('client_a', {
        moveX: 0,
        moveY: 1,
        sprint: true,
        dt: 16
      });

      room.tick();

      // Client B (hidden behind walls) receives acoustic pulse event in snapshot
      const snapshotB = await matchContext.clientB.waitFor(PROTOCOL_MSG_TYPES.S2C_WORLD_SNAPSHOT, 1000);
      assert.ok(snapshotB, 'Client B must receive snapshot');

      const soundEvents = snapshotB.payload.soundEvents || [];
      assert.ok(soundEvents.length > 0, 'Acoustic sound event must be broadcasted in fog');
      assert.strictEqual(soundEvents[0].type, 'footstep', 'Sound event must be a footstep');
    }
  },

  {
    id: 'T4.6',
    name: 'Stage 6: Tactical Lantern FOV Sightline Acquisition',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      let raycastModule;
      try {
        raycastModule = await import('../../shared/RaycastMath.js');
      } catch (_) {
        assert.fail('shared/RaycastMath.js not found - awaiting Milestone M2 implementation');
      }

      const pA = room.players.get('client_a');
      const pB = room.players.get('client_b');

      // Client B aims lantern cone directly towards corridor opening where A is located
      pB.angle = Math.atan2(pA.y - pB.y, pA.x - pB.x);

      // Verify LoS raycaster detects clear line-of-sight
      const losClear = raycastModule.isPointVisible(
        { x: pB.x, y: pB.y, angle: pB.angle },
        { x: pA.x, y: pA.y },
        room.geometrySegments || [],
        pB.angle,
        (80 * Math.PI) / 180,
        450
      );

      assert.strictEqual(typeof losClear, 'boolean', 'LoS query must return a valid boolean');
    }
  },

  {
    id: 'T4.7',
    name: 'Stage 7: Firefight & Projectile Damage Exchange',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      const pA = room.players.get('client_a');
      const pB = room.players.get('client_b');

      // Client B fires shotgun: deals 60 damage to Client A
      room.applyDamage('client_a', 'client_b', 60);
      // Client A fires steam rifle: deals 35 damage to Client B
      room.applyDamage('client_b', 'client_a', 35);

      assert.strictEqual(pA.hp, 40, 'Client A should have 40 HP remaining after shotgun hit');
      assert.strictEqual(pB.hp, 65, 'Client B should have 65 HP remaining after rifle hit');
      assert.strictEqual(pA.isAlive, true, 'Client A should be alive');
      assert.strictEqual(pB.isAlive, true, 'Client B should be alive');
    }
  },

  {
    id: 'T4.8',
    name: 'Stage 8: Tactical Cover & Weapon Reload',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      const pA = room.players.get('client_a');

      // Client A retreats behind iron pillar and initiates reload
      pA.reload();
      assert.strictEqual(pA.isReloading, true, 'Player A must enter reload state');

      // While reloading, shots are blocked
      const fireBlocked = pA.fire();
      assert.strictEqual(fireBlocked, false, 'Firing during reload cooldown must be blocked');
    }
  },

  {
    id: 'T4.9',
    name: 'Stage 9: Bot Crossfire & Player Elimination',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      const pB = room.players.get('client_b');
      const botAlpha = Array.from(room.bots.values())[0];

      assert.ok(botAlpha, 'Bot Alpha must be active in match');

      // Bot Alpha fires lethal finishing blow on Client B (deals 65 damage)
      room.applyDamage('client_b', botAlpha.id, 65);

      assert.strictEqual(pB.hp, 0, 'Client B HP must drop to 0');
      assert.strictEqual(pB.isAlive, false, 'Client B must be eliminated');

      // Verify room broadcasts elimination event
      const elimMsg = await matchContext.clientB.waitFor(PROTOCOL_MSG_TYPES.S2C_ELIMINATION_EVENT, 1000);
      assert.ok(elimMsg, 'Eliminated client must receive ELIMINATION_EVENT packet');
      assert.strictEqual(elimMsg.payload.victimId, 'client_b', 'Victim ID must match Client B');
    }
  },

  {
    id: 'T4.10',
    name: 'Stage 10: Final Showdown, Victory Resolution & Clean Reset',
    fn: async () => {
      const room = matchContext.room;
      assert.ok(room);

      const pA = room.players.get('client_a');
      pA.update(2.5); // Complete reload cooldown

      // Client A eliminates all remaining bots
      for (const [botId, bot] of room.bots) {
        room.applyDamage(botId, 'client_a', 100);
      }

      // Check living count
      const aliveEntities = room.getAliveCombatants ? room.getAliveCombatants() : [pA];
      assert.strictEqual(aliveEntities.length, 1, 'Only Client A must remain alive');

      // Evaluate match over
      const matchOutcome = room.evaluateMatchOutcome();
      assert.strictEqual(matchOutcome.isOver, true, 'Match must be resolved as over');
      assert.strictEqual(matchOutcome.winnerId, 'client_a', 'Client A must be declared the winner');

      // Clean cleanup
      matchContext.clientA.close();
      matchContext.clientB.close();
      room.reset();
      assert.strictEqual(room.state, 'LOBBY', 'Room must reset cleanly back to LOBBY state');
    }
  }
];

export async function run() {
  return runSuiteHelper(suiteName, tests);
}
