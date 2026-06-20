const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '64kb' }));

// --- Entries registry (demo: no auth) ---
// Admin pre-registers entries (team name + email). A participant "logs in"
// with their email, which resolves to their team, then makes their picks.
// NOTE: Heroku's filesystem is ephemeral — this resets on dyno restart and on
// every deploy. The seed below is re-created on startup so the demo always
// works. Swap for a database before relying on it.
const ENTRIES_FILE = path.join(__dirname, 'entries.json');
const SEED = [
  { email: 'brandon.dartt@ferguson.com', teamName: 'Brandon Dartt' }
];

const lc = s => (s || '').trim().toLowerCase();

function blankEntry(email, teamName) {
  return { email: lc(email), teamName, starters: [], bench: [], pick: '', pickScore: null, submitted: false, submittedAt: null };
}
function readEntries() {
  try { return JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8')); }
  catch {
    const seeded = SEED.map(s => blankEntry(s.email, s.teamName));
    writeEntries(seeded);
    return seeded;
  }
}
function writeEntries(list) { fs.writeFileSync(ENTRIES_FILE, JSON.stringify(list, null, 2)); }
function publicEntry(e) {
  return { email: e.email, teamName: e.teamName, starters: e.starters, bench: e.bench, pick: e.pick, pickScore: e.pickScore, submitted: e.submitted, submittedAt: e.submittedAt };
}

// Participant logs in with email -> resolve their team + any existing picks.
app.get('/api/entry', (req, res) => {
  const e = readEntries().find(x => x.email === lc(req.query.email));
  if (!e) return res.status(404).json({ ok: false, error: 'No team is registered to that email. Check with the pool admin.' });
  res.json({ ok: true, entry: publicEntry(e) });
});

// Participant submits / updates their picks (must match a registered email).
app.post('/api/submit', (req, res) => {
  const b = req.body || {};
  const starters = Array.isArray(b.starters) ? b.starters.filter(Boolean) : [];
  const bench = Array.isArray(b.bench) ? b.bench.filter(Boolean) : [];
  const pick = (b.pick || '').trim();
  const pickScore = Math.round(Number(b.pickScore));

  const list = readEntries();
  const e = list.find(x => x.email === lc(b.email));
  if (!e) return res.status(403).json({ ok: false, error: 'That email is not registered. Log in with your registered email.' });
  if (starters.length !== 5) return res.status(400).json({ ok: false, error: 'Pick exactly 5 starters.' });
  if (bench.length !== 2) return res.status(400).json({ ok: false, error: 'Pick exactly 2 bench players.' });
  const all = [...starters, ...bench];
  if (new Set(all).size !== all.length) return res.status(400).json({ ok: false, error: 'No duplicate players.' });
  if (!pick) return res.status(400).json({ ok: false, error: 'Pick an outright winner.' });
  if (!Number.isFinite(pickScore)) return res.status(400).json({ ok: false, error: 'Enter the predicted winning score.' });

  Object.assign(e, { starters, bench, pick, pickScore, submitted: true, submittedAt: new Date().toISOString() });
  writeEntries(list);
  res.json({ ok: true, teamName: e.teamName });
});

// --- Admin: manage the registry ---
app.get('/api/entries', (_req, res) => res.json(readEntries().map(publicEntry)));

app.post('/api/entries', (req, res) => {
  const teamName = (req.body?.teamName || '').trim();
  const email = lc(req.body?.email);
  if (!teamName) return res.status(400).json({ ok: false, error: 'Team name is required.' });
  if (!email) return res.status(400).json({ ok: false, error: 'Email is required.' });
  const list = readEntries();
  if (list.some(x => x.email === email)) return res.status(409).json({ ok: false, error: 'That email is already registered.' });
  list.push(blankEntry(email, teamName));
  writeEntries(list);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8765;
app.listen(port, () => console.log(`U.S. Open Matrix pool running on ${port}`));
