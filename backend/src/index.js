import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { initDatabase, prepare } from './config/database.js';
import routes from './routes/index.js';
import scheduler from './services/scheduler.js';
import { recoverStuckCreativeJobs } from './services/creative/creativeVideoEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3051;

app.use(cors());
app.use(express.json());
app.use('/api', routes);

const distPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@shortvid.local';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = await bcrypt.hash(password, 10);
  const existing = prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    prepare('UPDATE users SET password = ?, name = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      hash,
      'Admin',
      'admin',
      existing.id
    );
    console.log(`✅ shortvid admin reset on boot: ${email}`);
    return;
  }
  prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)').run(
    email,
    hash,
    'Admin',
    'admin'
  );
  console.log(`✅ shortvid admin created: ${email}`);
}

async function start() {
  await initDatabase();
  await seedAdmin();
  try {
    recoverStuckCreativeJobs(45);
  } catch (e) {
    console.warn('recoverStuckCreativeJobs:', e.message);
  }
  scheduler.init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎬 shortvid http://0.0.0.0:${PORT}`);
  });
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
