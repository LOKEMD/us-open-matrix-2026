const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '64kb' }));

// --- Team submissions (demo: no auth, stored in a JSON file) ---
// NOTE: Heroku's filesystem is ephemeral — this file resets when the dyno
// restarts (roughly daily, and on every deploy). Fine for a demo; swap for a
// database (e.g. Heroku Postgres) before relying on it.
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

function readSubs() {
  try { return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')); }
  catch { return []; }
}
function writeSubs(list) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2));
}

app.post('/api/submit', (req, res) => {
  const b = req.body || {};
  const name = (b.teamName || '').trim();
  const email = (b.email || '').trim();
  const starters = Array.isArray(b.starters) ? b.starters.filter(Boolean) : [];
  const bench = Array.isArray(b.bench) ? b.bench.filter(Boolean) : [];
  const pick = (b.pick || '').trim();

  if (!name) return res.status(400).json({ ok: false, error: 'Team name is required.' });
  if (!email) return res.status(400).json({ ok: false, error: 'Email is required.' });
  if (starters.length !== 5) return res.status(400).json({ ok: false, error: 'Pick exactly 5 starters.' });
  if (bench.length !== 2) return res.status(400).json({ ok: false, error: 'Pick exactly 2 bench players.' });
  const all = [...starters, ...bench];
  if (new Set(all).size !== all.length) return res.status(400).json({ ok: false, error: 'No duplicate players.' });
  if (!pick) return res.status(400).json({ ok: false, error: 'Pick an outright winner.' });

  const subs = readSubs();
  const entry = {
    id: 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    teamName: name, email, starters, bench, pick,
    submittedAt: new Date().toISOString(),
    // demo only: not a confirmed/verified submission yet
    confirmed: false
  };
  subs.push(entry);
  writeSubs(subs);
  res.json({ ok: true, id: entry.id });
});

app.get('/api/submissions', (_req, res) => res.json(readSubs()));

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8765;
app.listen(port, () => console.log(`U.S. Open Matrix pool running on ${port}`));
