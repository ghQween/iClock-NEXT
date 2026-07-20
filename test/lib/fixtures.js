'use strict';
// Synthetic punch-log generators shared by the correctness tests and the
// perf benchmark, so both exercise the same shapes of data.

// Local midnight for a Y/M/D, hour/minute offset — mirrors how the app
// itself builds timestamps (new Date(y, m-1, d, h, m)), so generated data
// behaves exactly like real manually-entered punches would.
function ts(y, m, d, h = 0, min = 0) {
  return new Date(y, m - 1, d, h, min, 0).getTime();
}

// N years of weekday shifts (in → depart → return → out, 8am-4pm, with a 2h
// route leg), plus an extra route every 5th workday. This is the same shape
// used to benchmark calcRouteForDay/renderHistory/buildBackupHTML earlier.
function multiYearLog({ startYear = 2023, workdays = 1000 } = {}) {
  const punches = [];
  let id = 1;
  let count = 0;
  for (let d = 0; count < workdays; d++) {
    const day = new Date(startYear, 0, 1 + d);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    count++;
    const y = day.getFullYear(), m = day.getMonth() + 1, dd = day.getDate();
    const base = ts(y, m, dd, 8, 0);
    punches.push({ id: id++, type: 'in', ts: base, note: '' });
    punches.push({ id: id++, type: 'depart', ts: base + 2 * 3600000, note: '' });
    punches.push({ id: id++, type: 'return', ts: base + 4 * 3600000, note: '' });
    if (count % 5 === 0) {
      punches.push({ id: id++, type: 'rstart', ts: base + 5 * 3600000, note: 'extra route' });
      punches.push({ id: id++, type: 'rend', ts: base + 6 * 3600000, note: '' });
    }
    punches.push({ id: id++, type: 'out', ts: base + 8 * 3600000, note: '' });
  }
  return { punches, nextId: id, workdays: count };
}

module.exports = { ts, multiYearLog };
