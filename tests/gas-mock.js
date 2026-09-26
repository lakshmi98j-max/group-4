// Minimal in-memory mock of the Apps Script services used by backend/apps-script.gs,
// so the backend can be tested with plain Node (no Google account needed).
const fs = require('fs');
const vm = require('vm');

function makeSheet(name) {
  const data = []; // array of rows (arrays)
  const sheet = {
    name, data, frozen: 0, raw: [],
    getLastRow() { return data.length; },
    getLastColumn() { return data.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxRows() { return 1000; },
    setFrozenRows(n) { this.frozen = n; },
    appendRow(row) {
      sheet.raw.push(row.slice());
      // Sheets keeps a leading apostrophe as a text marker, not part of the value.
      data.push(row.map(v => (typeof v === 'string' && v.startsWith("'")) ? v.slice(1) : v));
      return sheet;
    },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              const v = (data[r - 1 + i] || [])[c - 1 + j];
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          sheet.raw.push(vals[0].slice());
          for (let i = 0; i < nr; i++) {
            if (!data[r - 1 + i]) data[r - 1 + i] = [];
            for (let j = 0; j < nc; j++) {
              let v = vals[i][j];
              if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
              data[r - 1 + i][c - 1 + j] = v;
            }
          }
          return this;
        },
        setValue(v) { return this.setValues([[v]]); },
        setFontWeight() { return this; }
      };
    }
  };
  return sheet;
}

function createEnv(props = {}) {
  const sheets = {};
  const cache = {};
  const lockLog = [];
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n))
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { lockLog.push('lock'); }, releaseLock() { lockLog.push('release'); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } })
    },
    Logger: { log() {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.env.GAS_FILE, 'utf8'), ctx);
  return {
    ctx, sheets, lockLog,
    post(obj) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).content); },
    postRaw(raw) { return JSON.parse(ctx.doPost({ postData: { contents: raw } }).content); },
    get(params) { return JSON.parse(ctx.doGet({ parameter: params }).content); },
    table(name) {
      const s = sheets[name]; if (!s) return [];
      const [head, ...rows] = s.data;
      return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    }
  };
}
module.exports = { createEnv };
