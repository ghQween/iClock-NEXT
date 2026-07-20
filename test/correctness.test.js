'use strict';
// Correctness regression suite for the pure calculation engine (derive() and
// the calc*ForDay family). Plain Node, no dependencies, no browser:
//
//   node test/correctness.test.js
//
// Each test gets a fresh engine (loadEngine() re-runs index.html's inline
// script from scratch), so state always starts at defaultState() — no
// cross-test contamination to reason about.
//
// This exists because that engine has no test coverage at all otherwise,
// and it's exactly the kind of code where a "safe-looking" edit is easy to
// get subtly wrong: derive() and its calc*ForDay callers already carry
// several documented past bugs (a forgotten clock-out silently zeroing a
// day's hours, a multi-day span vanishing from every listing surface, a
// perf fix applied to one of three sibling functions but not the other
// two). The last case is exactly why the cache-vs-fresh test below exists:
// calcRouteForDay/calcShiftForDay were recently given an internal cache
// (see index.html) that must never let the cached and freshly-computed
// answer disagree.

const assert = require('node:assert/strict');
const { loadEngine } = require('./lib/engine');
const { ts, multiYearLog } = require('./lib/fixtures');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── Basic shift math ──────────────────────────────────────────────────

test('simple in -> out shift computes exact hours', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 8, 0), note: '' },
    { id: 2, type: 'out', ts: ts(2025, 6, 2, 16, 0), note: '' },
  ];
  state.nextId = 3;
  const drv = env.derive();
  assert.equal(env.calcHoursForDay('2025-06-02', drv), 8);
  assert.equal(env.calcShiftForDay('2025-06-02', drv), 8);
});

test('depart/return leg counts toward route hours but not extra shift hours', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 8, 0), note: '' },
    { id: 2, type: 'depart', ts: ts(2025, 6, 2, 9, 0), note: '' },
    { id: 3, type: 'return', ts: ts(2025, 6, 2, 10, 30), note: '' },
    { id: 4, type: 'out', ts: ts(2025, 6, 2, 16, 0), note: '' },
  ];
  state.nextId = 5;
  const drv = env.derive();
  assert.equal(env.calcShiftForDay('2025-06-02', drv), 8, 'shift span is still clock-in to clock-out');
  assert.equal(env.calcRouteForDay('2025-06-02', drv), 1.5, 'route hours are just the depart->return leg');
  assert.equal(env.calcHoursForDay('2025-06-02', drv), 8, 'route time is inside the shift span, not additive');
});

test('extra route (rstart/rend) outside a shift is paid and counted as route time', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 8, 0), note: '' },
    { id: 2, type: 'out', ts: ts(2025, 6, 2, 16, 0), note: '' },
    { id: 3, type: 'rstart', ts: ts(2025, 6, 2, 17, 0), note: 'second route' },
    { id: 4, type: 'rend', ts: ts(2025, 6, 2, 18, 30), note: '' },
  ];
  state.nextId = 5;
  const drv = env.derive();
  assert.equal(env.calcRouteForDay('2025-06-02', drv), 1.5);
  assert.equal(env.calcHoursForDay('2025-06-02', drv), 9.5, 'extra route time is additive to paid hours');
  assert.equal(env.calcShiftForDay('2025-06-02', drv), 8, 'the extra route is outside the shift span');
});

test('overnight shift splits hours across the midnight boundary', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 23, 0), note: '' },
    { id: 2, type: 'out', ts: ts(2025, 6, 3, 7, 0), note: '' },
  ];
  state.nextId = 3;
  const drv = env.derive();
  const day1 = env.calcHoursForDay('2025-06-02', drv);
  const day2 = env.calcHoursForDay('2025-06-03', drv);
  assert.equal(day1, 1, '11pm -> midnight is 1h on the first day');
  assert.equal(day2, 7, 'midnight -> 7am is 7h on the second day');
  assert.equal(day1 + day2, 8, 'total still adds up to the full 8h shift');
});

test('an open shift is capped at OPEN_WARN_MS regardless of how much later "now" is', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  const start = ts(2025, 6, 2, 8, 0);
  state.punches = [{ id: 1, type: 'in', ts: start, note: '' }];
  state.nextId = 2;
  const drv = env.derive();
  const farFuture = start + 100 * 3600000; // "checked back 100h later"
  const cappedHours = env.calcHoursForDay('2025-06-02', drv, farFuture); // explicit `now` bypasses the cache
  assert.equal(cappedHours, env.__bridge__.OPEN_WARN_MS / 3600000, 'capped at the 16h forgotten-clock-out ceiling');
});

// ── dayIssues flags ───────────────────────────────────────────────────

test('a complete in->depart->return->out day raises no issues', () => {
  // A bare in->out with no route leg is intentionally flagged by the app
  // (dayIssues raises issNoDepart for any closed shift with zero departs —
  // this is a route/delivery timeclock, where a route leg is expected every
  // shift), so "clean" here means the full 4-stage cycle, not the minimal one.
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 8, 0), note: '' },
    { id: 2, type: 'depart', ts: ts(2025, 6, 2, 9, 0), note: '' },
    { id: 3, type: 'return', ts: ts(2025, 6, 2, 10, 30), note: '' },
    { id: 4, type: 'out', ts: ts(2025, 6, 2, 16, 0), note: '' },
  ];
  state.nextId = 5;
  const drv = env.derive();
  // .length, not assert.deepEqual(..., []): the returned array is built
  // inside the vm sandbox, so it has a different (cross-realm) Array
  // prototype than a `[]` literal in this file — deepEqual's fast path for
  // empty arrays trips on that even though the values are equivalent.
  assert.equal(env.dayIssues('2025-06-02', drv).length, 0);
});

test('a duplicate depart without an intervening return is flagged', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.punches = [
    { id: 1, type: 'in', ts: ts(2025, 6, 2, 8, 0), note: '' },
    { id: 2, type: 'depart', ts: ts(2025, 6, 2, 9, 0), note: '' },
    { id: 3, type: 'depart', ts: ts(2025, 6, 2, 9, 30), note: '' },
    { id: 4, type: 'out', ts: ts(2025, 6, 2, 16, 0), note: '' },
  ];
  state.nextId = 5;
  const drv = env.derive();
  assert.ok(env.dayIssues('2025-06-02', drv).length >= 1);
});

// ── Weekly pay ────────────────────────────────────────────────────────

test('calcPayForWeek: exactly the OT threshold has zero OT hours', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  state.settings.hourlyRate = 20;
  state.settings.otWeeklyThreshold = 40;
  state.settings.otMultiplier = 1.5;
  state.punches = [];
  let id = 1;
  // Mon-Fri, 8h/day = 40h, starting Monday 2025-06-02
  for (let d = 2; d <= 6; d++) {
    state.punches.push({ id: id++, type: 'in', ts: ts(2025, 6, d, 8, 0), note: '' });
    state.punches.push({ id: id++, type: 'out', ts: ts(2025, 6, d, 16, 0), note: '' });
  }
  state.nextId = id;
  const drv = env.derive();
  const week = env.calcPayForWeek('2025-06-02', drv);
  assert.equal(week.totalHours, 40);
  assert.equal(week.regHours, 40);
  assert.equal(week.otHours, 0);
  assert.equal(week.pay, 800);
});

// ── The regression guard: cached vs. freshly-computed must always agree ─
// calcRouteForDay/calcShiftForDay cache their unioned interval array on
// `drv` (see index.html) the same way calcHoursForDay already did. The
// 3-arg form (explicit `now`) deliberately bypasses that cache. If a future
// edit breaks the cache — stale invalidation, wrong pinned `now`, whatever —
// this is what catches it: the two paths must return identical numbers for
// every day, always.

test('calcRouteForDay/calcShiftForDay/calcHoursForDay: cached path matches the cache-bypassing path for every day', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  const { punches, nextId } = multiYearLog({ workdays: 60 }); // small: this test runs on every change
  state.punches = punches;
  state.nextId = nextId;
  const pinnedNow = Date.now();
  const drv = env.derive();
  const keys = env.listedDayKeys(drv);
  assert.ok(keys.length > 0, 'sanity: the fixture actually produced listed days');
  for (const key of keys) {
    assert.equal(
      env.calcRouteForDay(key, drv), env.calcRouteForDay(key, drv, pinnedNow),
      `calcRouteForDay disagrees between cached and fresh for ${key}`);
    assert.equal(
      env.calcShiftForDay(key, drv), env.calcShiftForDay(key, drv, pinnedNow),
      `calcShiftForDay disagrees between cached and fresh for ${key}`);
    assert.equal(
      env.calcHoursForDay(key, drv), env.calcHoursForDay(key, drv, pinnedNow),
      `calcHoursForDay disagrees between cached and fresh for ${key}`);
  }
});

test('buildBackupHTML runs end-to-end over a multi-day log without throwing and embeds every day', () => {
  const env = loadEngine();
  const { state } = env.__bridge__;
  const { punches, nextId } = multiYearLog({ workdays: 20 });
  state.punches = punches;
  state.nextId = nextId;
  const drv = env.derive();
  const keys = env.listedDayKeys(drv);
  const html = env.buildBackupHTML();
  assert.equal(typeof html, 'string');
  for (const key of keys) {
    assert.ok(html.includes(key), `backup HTML is missing day ${key}`);
  }
});

// ── Runner ────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed > 0 ? 1 : 0);
