'use strict';
// Perf-regression benchmark for the calculation engine, formalizing the
// ad-hoc stress test used to find (and verify the fix for) calcRouteForDay/
// calcShiftForDay rebuilding and re-sorting the full punch log on every
// call instead of caching like their sibling calcHoursForDay. Plain Node,
// no browser:
//
//   node test/perf-benchmark.js
//
// Each measurement is checked against a BASELINE_MS ceiling below and the
// process exits non-zero if any exceeds it, so this can catch a
// reintroduced O(days x n log n) pattern (or similar) before it ships, not
// just report a number to eyeball. Ceilings are set at roughly 3x the
// measured time on the machine this was authored on — enough headroom to
// not be flaky across hardware, tight enough to still catch a real
// regression (the original bug this suite guards against was ~6-10x
// slower than the fixed version, not 20% slower).
//
// The measured loops run as part of the SAME generated module as
// derive()/calc*ForDay (via runInEngine's extraSource), not as repeated
// require()r->module calls from out here — see engine.js's module comment
// for why that distinction turned out to matter a lot for a benchmark
// specifically (a vm-sandboxed version of this exact loop measured 10x+
// slower purely from V8 context overhead, before this file settled on
// require() instead of vm).

const { runInEngine } = require('./lib/engine');
const { multiYearLog } = require('./lib/fixtures');

const WORKDAYS = 1000; // ~4 years of weekday shifts, same scale as the original finding

// Measured over 3 runs while authoring this file (Node 22, M-series Mac):
//   derive() x20                          ~0.45-0.47ms
//   calcHoursForDay over all listed days  ~22.6-24.7ms  (measured first; pays
//                                          a one-time JIT-warmup cost for
//                                          shared helpers like sumMsForDay/
//                                          unionIntervals that the next two
//                                          measurements then get for free —
//                                          the three aren't directly
//                                          comparable to each other, only
//                                          each to its own budget over time)
//   calcRouteForDay over all listed days  ~12.3-19.4ms
//   calcShiftForDay over all listed days  ~9.8-15.7ms
//   buildBackupHTML() x3                  ~95.3-97.0ms
// Budgets below are ~2x the observed max — enough headroom to not be flaky
// run-to-run or machine-to-machine, while still catching a regression on
// the order of the one this suite exists for (the unfixed calcRouteForDay
// was ~6-10x slower than the fixed version, not ~20% slower).
const BASELINES_MS = {
  'derive() x20': 5,
  'calcHoursForDay over all listed days': 50,
  'calcRouteForDay over all listed days': 40,
  'calcShiftForDay over all listed days': 30,
  'buildBackupHTML() x3': 180,
};

function benchmarkSource(fixture) {
  return `
;var __PERF__ = {};
(function() {
  state.punches = ${JSON.stringify(fixture.punches)};
  state.nextId = ${JSON.stringify(fixture.nextId)};

  function timeIt(fn, iters) {
    iters = iters || 1;
    var t0 = performance.now();
    for (var i = 0; i < iters; i++) fn();
    return (performance.now() - t0) / iters;
  }

  __PERF__['derive() x20'] = timeIt(function() { derive(); }, 20);

  var drv = derive();
  var keys = listedDayKeys(drv);
  __PERF__.listedDays = keys.length;

  // Fresh drv per measured function so each pays its own first-call
  // cache-population cost, matching how a real render actually calls them.
  drv = derive();
  __PERF__['calcHoursForDay over all listed days'] = timeIt(function() {
    for (var i = 0; i < keys.length; i++) calcHoursForDay(keys[i], drv);
  });

  drv = derive();
  __PERF__['calcRouteForDay over all listed days'] = timeIt(function() {
    for (var i = 0; i < keys.length; i++) calcRouteForDay(keys[i], drv);
  });

  drv = derive();
  __PERF__['calcShiftForDay over all listed days'] = timeIt(function() {
    for (var i = 0; i < keys.length; i++) calcShiftForDay(keys[i], drv);
  });

  __PERF__['buildBackupHTML() x3'] = timeIt(function() { buildBackupHTML(); }, 3);
})();
module.exports.__PERF__ = __PERF__;
`;
}

function main() {
  const fixture = multiYearLog({ workdays: WORKDAYS });
  const env = runInEngine(benchmarkSource(fixture));
  const results = env.__PERF__;

  console.log(`Benchmark scale: ${fixture.workdays} workdays, ${fixture.punches.length} punches, ${results.listedDays} listed days\n`);

  let anyOverBudget = false;
  const nameWidth = Math.max(...Object.keys(BASELINES_MS).map((n) => n.length));
  for (const name of Object.keys(BASELINES_MS)) {
    const ms = results[name];
    const budget = BASELINES_MS[name];
    const over = ms > budget;
    if (over) anyOverBudget = true;
    const status = over ? 'OVER BUDGET' : 'ok';
    console.log(`  ${name.padEnd(nameWidth)}  ${ms.toFixed(2).padStart(7)}ms  (budget ${budget}ms)  ${status}`);
  }

  if (anyOverBudget) {
    console.error('\nOne or more measurements exceeded their budget — investigate before shipping.');
    console.error('If this is a deliberate, understood tradeoff, update BASELINES_MS in this file.');
    process.exit(1);
  }
  console.log('\nAll measurements within budget.');
}

main();
