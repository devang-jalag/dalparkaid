// Automated Frontend & Security Verification Suite for DalParkAid Website
// Run via: node --test scripts/testWebsite.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { sanitizeCSVCell } from './exportPilotSignupsToExcel.mjs';

const ROOT = process.cwd();
const HTML_PATH = path.join(ROOT, 'web', 'index.html');
const LOTS_PATH = path.join(ROOT, 'web', 'lotsData.js');
const SIM_PATH = path.join(ROOT, 'web', 'simulator.js');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');
const LOGO_WEB_PATH = path.join(ROOT, 'web', 'assets', 'dalparkaid-logo.png');
const LOGO_DOCS_PATH = path.join(ROOT, 'docs', 'assets', 'dalparkaid-logo.png');

const htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
const lotsContent = fs.readFileSync(LOTS_PATH, 'utf8');
const simContent = fs.readFileSync(SIM_PATH, 'utf8');
const rulesContent = fs.readFileSync(RULES_PATH, 'utf8');
const gitignoreContent = fs.readFileSync(GITIGNORE_PATH, 'utf8');

test('1. Dataset Integrity: All 28 Dalhousie lots & 7 HRM parkades have valid coordinates and capacities', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(lotsContent, sandbox);

  assert.ok(Array.isArray(sandbox.window.DAL_LOTS), 'DAL_LOTS should be an array');
  assert.equal(sandbox.window.DAL_LOTS.length, 28, 'Should contain all 28 Dalhousie lots');

  assert.ok(Array.isArray(sandbox.window.HRM_EXPANSION_LOTS), 'HRM_EXPANSION_LOTS should be an array');
  assert.equal(sandbox.window.HRM_EXPANSION_LOTS.length, 7, 'Should contain 7 HRM expansion lots');

  for (const lot of sandbox.window.DAL_LOTS) {
    assert.ok(lot.id && lot.name, 'Lot must have id and name');
    assert.ok(
      lot.coordinate &&
        typeof lot.coordinate.latitude === 'number' &&
        lot.coordinate.latitude > 44.6 &&
        lot.coordinate.latitude < 44.7,
      `Invalid latitude for ${lot.id}`
    );
    assert.ok(
      typeof lot.coordinate.longitude === 'number' &&
        lot.coordinate.longitude > -63.65 &&
        lot.coordinate.longitude < -63.55,
      `Invalid longitude for ${lot.id}`
    );
    const totalCap =
      (lot.generalSpaces || 0) +
      (lot.reservedSpaces || 0) +
      (lot.shortTermSpaces || 0) +
      (lot.eveningGeneralSpaces || 0) +
      (lot.eveningShortTermSpaces || 0);
    assert.ok(totalCap > 0, `Lot ${lot.id} must have positive stall capacity`);
  }
});

test('2. Proprietary Algorithm Protection: No internal formulas or raw source file paths exposed in HTML', () => {
  assert.ok(!htmlContent.includes('src/utils/engine.js'), 'Should not expose internal file path src/utils/engine.js');
  assert.ok(!htmlContent.includes('exp(-ageMins'), 'Should not expose exponential decay formula');
  assert.ok(!htmlContent.includes('proof(1.15)'), 'Should not expose proof weight multiplier');
  assert.ok(!htmlContent.includes('VECTOR DELTAS'), 'Should not expose raw vector deltas HUD');
});

test('3. Content & Copy Standards: Zero em-dashes, verified Dalhousie/HRM facts, and updated brand logo present', () => {
  assert.ok(!htmlContent.includes('—'), 'index.html must not contain em-dashes');
  assert.ok(!simContent.includes('—'), 'simulator.js must not contain em-dashes');
  assert.ok(htmlContent.includes('21,300+'), 'Should cite verified 21,300+ Dalhousie enrollment');
  assert.ok(htmlContent.includes('$45'), 'Should cite verified $45 HRM parking violation fine');
  assert.ok(htmlContent.includes('4:30 PM'), 'Should cite verified 4:30 PM daytime permit transition');
  assert.ok(htmlContent.includes('./assets/dalparkaid-logo.png'), 'Should reference the uploaded DalParkAid logo');
  assert.ok(fs.existsSync(LOGO_WEB_PATH), 'Logo PNG must exist in web/assets/');
  assert.ok(fs.existsSync(LOGO_DOCS_PATH), 'Logo PNG must exist in docs/assets/');
});

test('4. Nielsen Usability Heuristics: Required interactive controls and recovery elements exist in DOM', () => {
  const requiredIds = [
    'status-toast',
    'quick-lot-select',
    'permit-filter-select',
    'hour-scrubber',
    'halifax-map',
    'clear-route-btn',
    'lot-recovery-alert',
    'lot-recovery-btn',
    'undo-report-btn',
    'lot-physics-canvas',
    'c2m-form'
  ];

  for (const id of requiredIds) {
    assert.ok(
      htmlContent.includes(`id="${id}"`),
      `Missing required UI element id="${id}" in web/index.html`
    );
  }
});

test('5. Security V1: No public PII Excel download or localStorage signup dump in browser, and Firestore rules lock reads', () => {
  assert.ok(
    !htmlContent.includes('exportSignupsToExcelCSV'),
    'Public HTML must not contain exportSignupsToExcelCSV function'
  );
  assert.ok(
    !htmlContent.includes('Download Excel (.csv)'),
    'Public HTML must not expose a Download Excel (.csv) button to visitors'
  );
  assert.ok(
    !htmlContent.includes('dalparkaid_pilot_signups'),
    'Public HTML must not cache visitor PII in localStorage'
  );
  assert.ok(
    rulesContent.includes('match /pilotSignups/{signupId}') &&
      rulesContent.includes('allow read, update, delete: if false;'),
    'firestore.rules must block public read/update/delete on pilotSignups'
  );
});

test('6. Security V2: CSV Formula Injection sanitizer neutralizes dangerous spreadsheet prefixes', () => {
  assert.equal(sanitizeCSVCell('=cmd|"/c calc"!A0'), `"'=cmd|""/c calc""!A0"`);
  assert.equal(sanitizeCSVCell('+SUM(1,2)'), `"'+SUM(1,2)"`);
  assert.equal(sanitizeCSVCell('-2+3'), `"'-2+3"`);
  assert.equal(sanitizeCSVCell('@IMPORTXML()'), `"'@IMPORTXML()"`);
  assert.equal(sanitizeCSVCell('Normal Commuter Note'), `"Normal Commuter Note"`);
});

test('7. Security V3, V4, V5, V6, V7: Anti-bot honeypot, SRI, CSP, DOM XSS escaping, and gitignore protections', () => {
  // V3: Honeypot + maxlength + rate cooldown + allowlist
  assert.ok(htmlContent.includes('id="v-honey"'), 'Honeypot field #v-honey must be present');
  assert.ok(htmlContent.includes('maxlength="80"'), 'Name input must enforce maxlength="80"');
  assert.ok(htmlContent.includes('maxlength="120"'), 'Email input must enforce maxlength="120"');
  assert.ok(htmlContent.includes('maxlength="400"'), 'Note textarea must enforce maxlength="400"');
  assert.ok(htmlContent.includes('ALLOWED_ROLES'), 'Form handler must enforce role allowlist');

  // V4: Subresource Integrity (SRI) on Leaflet CDN
  assert.ok(
    htmlContent.includes('integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="'),
    'Leaflet CSS must have SHA-256 Subresource Integrity hash'
  );
  assert.ok(
    htmlContent.includes('integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="'),
    'Leaflet JS must have SHA-256 Subresource Integrity hash'
  );

  // V5: Content Security Policy & Referrer Policy
  assert.ok(
    htmlContent.includes('http-equiv="Content-Security-Policy"'),
    'index.html must include a Content-Security-Policy meta tag'
  );
  assert.ok(
    htmlContent.includes('name="referrer" content="strict-origin-when-cross-origin"'),
    'index.html must include strict-origin-when-cross-origin referrer policy'
  );

  // V6: DOM XSS HTML entity escaping in simulator.js
  assert.ok(
    simContent.includes('function escapeHTML(str)'),
    'simulator.js must define escapeHTML(str) sanitizer'
  );
  assert.ok(
    simContent.includes('escapeHTML(lot.name)') && simContent.includes('escapeHTML(char.name)'),
    'simulator.js must sanitize dynamic lot and commuter strings before HTML interpolation'
  );

  // V7: .gitignore blocks accidental commits of exported CSVs and PDFs
  assert.ok(gitignoreContent.includes('*.pdf'), '.gitignore must ignore *.pdf');
  assert.ok(
    gitignoreContent.includes('DalParkAid_Pilot_Signups*.csv'),
    '.gitignore must ignore DalParkAid_Pilot_Signups*.csv'
  );
});

test('8. Sync Verification: docs/ mirror matches web/ source files', () => {
  const docsHtml = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const docsSim = fs.readFileSync(path.join(ROOT, 'docs', 'simulator.js'), 'utf8');
  assert.equal(htmlContent, docsHtml, 'docs/index.html must match web/index.html');
  assert.equal(simContent, docsSim, 'docs/simulator.js must match web/simulator.js');
});
