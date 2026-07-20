'use strict';
// Loads the pure calculation engine (state, derive(), calc*ForDay, dayIssues,
// date helpers, I18N, buildBackupHTML, etc.) out of index.html for testing
// under plain Node — no browser, no DOM, no build step.
//
// index.html is one inline <script>. Everything from its start up to the
// "// ── INIT ──" comment is declarations only (functions, consts, `let
// state`) — nothing in that slice touches document/localStorage/navigator
// AT THE TOP LEVEL, so it's safe to run standalone. (DOM-touching functions
// like renderHistory/punchRow/el are still *defined* in the slice,
// harmlessly — a test just must not *call* them.) Everything from
// "// ── INIT ──" onward is the app's bootstrap: loadState(), event
// listener wiring, setInterval(updateClock, 1000) — real side effects we
// deliberately never run here.
//
// The slice is written to a temp .cjs file and require()'d as a normal
// CommonJS module, rather than run through Node's `vm` module. That's a
// deliberate choice, not the obvious one: vm.createContext/runInContext
// looked simpler at first (no temp file, no module wrapper) and correctness
// tests genuinely don't care either way — but a vm sandbox is a separate V8
// context, and global-variable access inside one goes through a slower path
// than a real top-level module in the main context. Measured on the
// calcHoursForDay-over-1000-days loop the perf benchmark runs: 294ms via
// vm vs 24ms via require() — over 10x, for identical code. A benchmark
// built on vm would have had budgets dominated by that tax instead of the
// engine's actual performance, defeating the point of having one.
//
// If this ever throws "Could not find ... marker", it means index.html's
// structure changed (script tag or the INIT comment moved/were renamed) —
// update the constants below to match.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const INIT_MARKER = '// ' + '──' + ' INIT ' + '──'; // "// ── INIT ──"

function extractEngineSource(html = fs.readFileSync(APP_HTML_PATH, 'utf8')) {
  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!scriptMatch) {
    throw new Error('engine.js: could not find the inline <script> block in index.html');
  }
  const fullScript = scriptMatch[1];
  const markerIdx = fullScript.indexOf(INIT_MARKER);
  if (markerIdx === -1) {
    throw new Error(`engine.js: could not find the "${INIT_MARKER}" marker in index.html's script — has it moved?`);
  }
  return fullScript.slice(0, markerIdx);
}

// A handful of top-level bindings in the engine slice are `const`/`let`
// (state, I18N, VALID_TYPES, STAGES, ...) rather than `function` —
// require() only returns what a module explicitly puts on module.exports,
// so this epilogue (appended to and run as part of the SAME source, so it
// shares scope with everything above it) is what actually exposes them.
// Function declarations are listed here too rather than relying on any
// auto-export trick, so this list doubles as "here is the tested surface."
// Object.assign, not a plain "module.exports = {...}" reassignment: a
// caller's extraSource (e.g. the perf benchmark's measurement loop) runs
// BEFORE this epilogue and may already have put its own results on
// module.exports — a reassignment here would silently wipe them out.
const EXPORTS_EPILOGUE = `
;Object.assign(module.exports, {
  derive, sortedPunches, punchesByDay,
  dateKey, todayKey, dayBounds, weekKey, weekDayKeys, formatDateKey,
  formatTime, formatTime24, formatDuration, fmtMoney,
  listedDayKeys, openSpanDays, openSpanCapped, closedSpanDays, closedSpans,
  closedSpanCapEnd, spannedDays, segmentsByStartDay,
  routeSegsForDay, routeNumberOf, nextRouteNumber, lastMarker,
  shiftIntervals, unionIntervals, extraIntervals, routeIntervals, sumMsForDay,
  calcHoursForDay, calcRouteForDay, calcShiftForDay, calcPayForDay, calcPayForWeek,
  dayIssues, escapeHtml, buildBackupHTML, csvCell, numOr,
  __bridge__: {
    get state() { return state; },
    get I18N() { return I18N; },
    get VALID_TYPES() { return VALID_TYPES; },
    get STAGES() { return STAGES; },
    get OPEN_WARN_MS() { return OPEN_WARN_MS; },
  },
});
`;

// Runs a fresh copy of the engine (optionally with extraSource appended,
// run as part of the SAME module so it shares scope with state/derive/etc)
// and returns the exports object described above. Each call writes and
// require()s a new temp file — a fresh path, so Node's require cache can
// never hand back a previous run's (stale) state — and deletes it
// immediately after; loadEngine()/runInEngine() give a fully isolated
// environment every time (state starts at defaultState()) rather than
// something you reset in place.
function runInEngine(extraSource = '') {
  const source = extractEngineSource() + '\n' + extraSource + '\n' + EXPORTS_EPILOGUE;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iclock-engine-'));
  const tmpFile = path.join(tmpDir, 'engine.cjs');
  try {
    fs.writeFileSync(tmpFile, source);
    return require(tmpFile);
  } finally {
    delete require.cache[require.resolve(tmpFile)];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadEngine() {
  return runInEngine();
}

module.exports = { loadEngine, runInEngine, extractEngineSource, APP_HTML_PATH };
