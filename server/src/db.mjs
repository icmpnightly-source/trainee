import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS athletes (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  gender        TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  birth_date    TEXT NOT NULL,
  height_cm     REAL,
  weight_kg     REAL,
  target_date   TEXT,
  target_grade  INTEGER NOT NULL DEFAULT 4,
  training_days INTEGER NOT NULL DEFAULT 4,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS results (
  id          INTEGER PRIMARY KEY,
  athlete_id  INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  value       REAL NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  details     TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS results_by_athlete ON results (athlete_id, exercise_id, recorded_at);

CREATE TABLE IF NOT EXISTS tracks (
  result_id INTEGER PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
  raw       TEXT NOT NULL,
  matched   TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id         INTEGER PRIMARY KEY,
  athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  source     TEXT NOT NULL,
  model      TEXT,
  error      TEXT,
  context    TEXT NOT NULL,
  plan       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

const ATHLETE_FIELDS = ["name", "gender", "birth_date", "height_cm", "weight_kg", "target_date", "target_grade", "training_days", "notes"];

const parseJson = (text) => (text == null ? null : JSON.parse(text));

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "trainee.db"));
  db.exec(SCHEMA);
  return wrap(db);
}

export function openMemoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(db) {
  const resultRow = (r) => r && { ...r, details: parseJson(r.details) };

  return {
    raw: db,

    listAthletes() {
      return db.prepare("SELECT * FROM athletes ORDER BY name COLLATE NOCASE").all();
    },
    getAthlete(id) {
      return db.prepare("SELECT * FROM athletes WHERE id = ?").get(id) ?? null;
    },
    createAthlete(a) {
      const cols = ATHLETE_FIELDS.filter((f) => a[f] !== undefined);
      const info = db
        .prepare(`INSERT INTO athletes (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .run(...cols.map((c) => a[c]));
      return this.getAthlete(Number(info.lastInsertRowid));
    },
    updateAthlete(id, a) {
      const cols = ATHLETE_FIELDS.filter((f) => a[f] !== undefined);
      if (cols.length) {
        db.prepare(`UPDATE athletes SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
          ...cols.map((c) => a[c]),
          id,
        );
      }
      return this.getAthlete(id);
    },
    deleteAthlete(id) {
      return db.prepare("DELETE FROM athletes WHERE id = ?").run(id).changes > 0;
    },

    listResults(athleteId) {
      return db
        .prepare("SELECT * FROM results WHERE athlete_id = ? ORDER BY recorded_at DESC, id DESC")
        .all(athleteId)
        .map(resultRow);
    },
    getResult(id) {
      return resultRow(db.prepare("SELECT * FROM results WHERE id = ?").get(id));
    },
    addResult({ athlete_id, exercise_id, value, source = "manual", details = null, recorded_at }) {
      const info = db
        .prepare(
          "INSERT INTO results (athlete_id, exercise_id, value, source, details, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(athlete_id, exercise_id, value, source, details == null ? null : JSON.stringify(details), recorded_at ?? new Date().toISOString());
      return this.getResult(Number(info.lastInsertRowid));
    },
    deleteResult(id) {
      return db.prepare("DELETE FROM results WHERE id = ?").run(id).changes > 0;
    },

    saveTrack(resultId, raw, matched) {
      db.prepare("INSERT OR REPLACE INTO tracks (result_id, raw, matched) VALUES (?, ?, ?)").run(
        resultId,
        JSON.stringify(raw),
        matched == null ? null : JSON.stringify(matched),
      );
    },
    getTrack(resultId) {
      const row = db.prepare("SELECT * FROM tracks WHERE result_id = ?").get(resultId);
      return row ? { raw: parseJson(row.raw), matched: parseJson(row.matched) } : null;
    },

    addPlan({ athlete_id, source, model, error, context, plan }) {
      const info = db
        .prepare("INSERT INTO plans (athlete_id, created_at, source, model, error, context, plan) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(athlete_id, new Date().toISOString(), source, model ?? null, error ?? null, JSON.stringify(context), JSON.stringify(plan));
      return this.getPlan(Number(info.lastInsertRowid));
    },
    getPlan(id) {
      const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id);
      return row && { ...row, context: parseJson(row.context), plan: parseJson(row.plan) };
    },
    listPlans(athleteId, limit = 10) {
      return db
        .prepare("SELECT id, created_at, source, model, error FROM plans WHERE athlete_id = ? ORDER BY id DESC LIMIT ?")
        .all(athleteId, limit);
    },

    getSetting(key) {
      return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
    },
    setSetting(key, value) {
      if (value == null || value === "") db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      else db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(value));
    },
  };
}
