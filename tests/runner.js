/**
 * Master Headless Test Runner for Steampunk Tactical Multiplayer Shooter
 * Executes all 4 tiers of automated test suites (52 tests) with zero external dependencies.
 * Provides colorized CLI reporting, performance metrics, and strict exit code semantics.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ANSI escape codes for colorized output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

class MasterTestRunner {
  constructor() {
    this.totalTests = 0;
    this.totalPassed = 0;
    this.totalFailed = 0;
    this.suiteResults = [];
    this.failures = [];
    this.startTime = 0;
  }

  log(msg = '') {
    console.log(msg);
  }

  printBanner() {
    this.log('');
    this.log(`${COLORS.bold}${COLORS.yellow}========================================================================${COLORS.reset}`);
    this.log(`${COLORS.bold}${COLORS.yellow}      STEAMPUNK TACTICAL SHOOTER — HEADLESS AUTOMATED TEST SUITE        ${COLORS.reset}`);
    this.log(`${COLORS.bold}${COLORS.yellow}========================================================================${COLORS.reset}`);
    this.log(`${COLORS.dim}Runtime: Node.js ${process.version} (${process.platform}-${process.arch})${COLORS.reset}`);
    this.log(`${COLORS.dim}Directory: ${resolve('tests')}${COLORS.reset}`);
    this.log('');
  }

  async runSuite(filePath, tierName) {
    const filename = filePath.split(/[/\\]/).pop();
    this.log(`${COLORS.bold}${COLORS.cyan}▶ Suite:${COLORS.reset} ${tierName}/${COLORS.bold}${filename}${COLORS.reset}`);

    let suiteModule;
    try {
      suiteModule = await import(pathToFileURL(filePath).href);
    } catch (err) {
      this.log(`  ${COLORS.red}✖ Failed to load suite module: ${err.message}${COLORS.reset}`);
      this.totalFailed++;
      this.failures.push({
        suite: `${tierName}/${filename}`,
        test: 'Module Import',
        error: err
      });
      return;
    }

    if (typeof suiteModule.run === 'function') {
      try {
        const result = await suiteModule.run();
        const passed = result?.passed || 0;
        const failed = result?.failed || 0;
        const total = result?.total || (passed + failed);

        this.totalPassed += passed;
        this.totalFailed += failed;
        this.totalTests += total;

        if (Array.isArray(result?.failures)) {
          for (const f of result.failures) {
            this.failures.push({
              suite: `${tierName}/${filename}`,
              test: f.name || f.id || 'Unknown',
              error: f.error
            });
          }
        }
      } catch (err) {
        this.log(`  ${COLORS.red}✖ Suite execution crashed: ${err.message}${COLORS.reset}`);
        this.totalFailed++;
        this.failures.push({
          suite: `${tierName}/${filename}`,
          test: 'Suite Runner',
          error: err
        });
      }
    } else {
      this.log(`  ${COLORS.yellow}⚠ Warning: Suite does not export a 'run()' function.${COLORS.reset}`);
    }
  }

  async runAll() {
    this.startTime = Date.now();
    this.printBanner();

    const tiers = [
      { id: 'tier1_unit', label: 'Tier 1: Unit & Micro-Integration Tests' },
      { id: 'tier2_boundary', label: 'Tier 2: Boundary & Edge Robustness Tests' },
      { id: 'tier3_integration', label: 'Tier 3: Subsystem Coupling & Cross-Feature Tests' },
      { id: 'tier4_e2e', label: 'Tier 4: End-to-End Match Lifecycle Tests' }
    ];

    for (const tier of tiers) {
      const tierDir = resolve('tests', tier.id);
      this.log(`${COLORS.bold}${COLORS.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
      this.log(`${COLORS.bold}${COLORS.magenta}${tier.label}${COLORS.reset}`);
      this.log(`${COLORS.bold}${COLORS.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);

      if (!existsSync(tierDir)) {
        this.log(`  ${COLORS.gray}(Directory not found: ${tierDir})${COLORS.reset}\n`);
        continue;
      }

      const files = readdirSync(tierDir)
        .filter(f => f.endsWith('.test.js'))
        .sort();

      if (files.length === 0) {
        this.log(`  ${COLORS.gray}(No .test.js files found in ${tier.id})${COLORS.reset}\n`);
        continue;
      }

      for (const file of files) {
        const fullPath = join(tierDir, file);
        await this.runSuite(fullPath, tier.id);
        this.log('');
      }
    }

    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    this.printSummary(duration);
  }

  printSummary(duration) {
    this.log(`${COLORS.bold}${COLORS.yellow}========================================================================${COLORS.reset}`);
    this.log(`${COLORS.bold}                      TEST EXECUTION SUMMARY                            ${COLORS.reset}`);
    this.log(`${COLORS.bold}${COLORS.yellow}========================================================================${COLORS.reset}`);
    this.log(`  ${COLORS.bold}Total Test Cases:${COLORS.reset}  ${this.totalTests}`);
    this.log(`  ${COLORS.green}${COLORS.bold}Passed:${COLORS.reset}            ${this.totalPassed}`);
    this.log(`  ${this.totalFailed > 0 ? COLORS.red : COLORS.gray}${COLORS.bold}Failed:${COLORS.reset}            ${this.totalFailed}`);
    this.log(`  ${COLORS.cyan}${COLORS.bold}Duration:${COLORS.reset}          ${duration}s`);
    this.log(`${COLORS.bold}${COLORS.yellow}========================================================================${COLORS.reset}`);

    if (this.failures.length > 0) {
      this.log(`\n${COLORS.bold}${COLORS.red}FAILURE BREAKDOWN (${this.failures.length}):${COLORS.reset}`);
      for (let i = 0; i < this.failures.length; i++) {
        const f = this.failures[i];
        this.log(`\n  ${COLORS.bold}${i + 1}. [${f.suite}] ${f.test}${COLORS.reset}`);
        const errMsg = f.error?.stack || f.error?.message || String(f.error);
        const indented = errMsg.split('\n').map(line => `     ${COLORS.red}${line}${COLORS.reset}`).join('\n');
        this.log(indented);
      }
      this.log('');
      this.log(`${COLORS.red}${COLORS.bold}✖ TEST SUITE RUN FAILED (${this.totalFailed} failures). Exiting code 1.${COLORS.reset}`);
      process.exit(1);
    } else {
      this.log('');
      this.log(`${COLORS.green}${COLORS.bold}✔ ALL ${this.totalTests} HEADLESS TESTS PASSED WITH 100% SUCCESS!${COLORS.reset}`);
      process.exit(0);
    }
  }
}

// Execute when invoked directly
const runner = new MasterTestRunner();
runner.runAll().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
