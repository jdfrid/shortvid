import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDataDir() {
  const fromEnv = (process.env.SHORTVID_DATA_DIR || '').trim();
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) fs.mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }
  const localPath = path.join(__dirname, '../../data');
  if (!fs.existsSync(localPath)) fs.mkdirSync(localPath, { recursive: true });
  return localPath;
}

const dataDir = getDataDir();
const dbPath = path.join(dataDir, 'shortvid.db');
console.log(`📁 shortvid DB: ${dbPath}`);

let db = null;

export async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'editor')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS creative_video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_source TEXT DEFAULT 'manual',
      video_description TEXT NOT NULL,
      script_tone TEXT NOT NULL,
      user_notes TEXT,
      brief_json TEXT,
      pexels_urls_json TEXT,
      character_id TEXT,
      render_provider TEXT DEFAULT 'shotstack',
      external_render_id TEXT,
      output_url TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_creative_jobs_status ON creative_video_jobs(status, created_at)`);

  const defaults = [
    ['creative_llm_provider', 'template'],
    ['creative_gemini_api_key', ''],
    ['creative_gemini_model', 'gemini-2.0-flash'],
    ['creative_openai_api_key', ''],
    ['creative_openai_model', 'gpt-4o-mini'],
    ['creative_video_provider', 'shotstack'],
    ['creative_video_auto_enabled', 'false'],
    ['creative_video_cron', '0 14 * * *'],
    [
      'creative_auto_description',
      'Short vertical video: practical tips about shopping smart and spotting real value online.'
    ],
    ['creative_auto_tone', 'adults'],
    ['creative_pexels_per_page', '6'],
    ['creative_pexels_orientation', 'portrait'],
    ['creative_pexels_timeout_sec', '45'],
    ['creative_pexels_prefer_quality', 'hd']
  ];
  for (const [key, value] of defaults) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  saveDatabase();
  console.log('✅ shortvid database ready');
  return db;
}

export function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

export function getDb() {
  return db;
}

export function prepare(sql) {
  return {
    get: (...params) => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    },
    all: (...params) => {
      const results = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    },
    run: (...params) => {
      db.run(sql, params);
      const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
      const changes = db.getRowsModified();
      saveDatabase();
      return { lastInsertRowid, changes };
    }
  };
}

export function getDataRoot() {
  return dataDir;
}
