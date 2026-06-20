const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '64kb' }));

// ---- Tournaments (the four majors) ----
// locked = picks can't be changed (tournament has started). current = the one
// open for picks. For The Open the field isn't published yet, so the picker
// falls back to a sample field (the US Open field) for the demo and switches
// to the real field automatically once ESPN publishes it.
const TOURNAMENTS = [
  { key: 'theopen', name: 'The Open',  eventId: '401811957', fieldEventId: '401811957', fallbackFieldEventId: '401811952', locked: false, current: true,  status: 'Upcoming' },
  { key: 'usopen',  name: 'U.S. Open', eventId: '401811952', fieldEventId: '401811952', locked: true,  current: false, status: 'In progress' }
];

// ---- Entries registry (demo: email login, no password) ----
// NOTE: Heroku's filesystem is ephemeral — resets on restart/deploy. The seed
// is re-created on startup so the demo always works. Use a database for real.
const ENTRIES_FILE = path.join(__dirname, 'entries.json');
const SEED = [{
  email: 'brandon.dartt@ferguson.com', teamName: 'Brandon Dartt', isAdmin: true,
  picks: {
    usopen: {
      starters: ['Patrick Reed', 'Rory McIlroy', 'Joaquin Niemann', 'Tommy Fleetwood', 'Justin Rose'],
      bench: ['Cameron Young', 'Xander Schauffele'],
      pick: 'Patrick Reed', pickScore: -2, submittedAt: '2026-06-17T12:00:00.000Z'
    }
  }
}];

const lc = s => (s || '').trim().toLowerCase();

function blankEntry(email, teamName, isAdmin) {
  return { email: lc(email), teamName, isAdmin: !!isAdmin, picks: {} };
}
function readEntries() {
  try { return JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8')); }
  catch {
    const seeded = SEED.map(s => ({ ...blankEntry(s.email, s.teamName, s.isAdmin), picks: s.picks || {} }));
    writeEntries(seeded);
    return seeded;
  }
}
function writeEntries(list) { fs.writeFileSync(ENTRIES_FILE, JSON.stringify(list, null, 2)); }
function publicEntry(e) {
  return { email: e.email, teamName: e.teamName, isAdmin: !!e.isAdmin, picks: e.picks || {} };
}
function findByEmail(email) { return readEntries().find(x => x.email === lc(email)); }
function isAdminEmail(email) { const e = findByEmail(email); return !!(e && e.isAdmin); }

app.get('/api/tournaments', (_req, res) => res.json(TOURNAMENTS));

// Participant logs in with email -> resolve their team + any existing picks.
app.get('/api/entry', (req, res) => {
  const e = findByEmail(req.query.email);
  if (!e) return res.status(404).json({ ok: false, error: 'No team is registered to that email. Check with the pool admin.' });
  res.json({ ok: true, entry: publicEntry(e) });
});

// Submit / update picks for a tournament (must be registered + tournament open).
app.post('/api/submit', (req, res) => {
  const b = req.body || {};
  const t = TOURNAMENTS.find(x => x.key === b.tournament);
  if (!t) return res.status(400).json({ ok: false, error: 'Unknown tournament.' });
  if (t.locked) return res.status(403).json({ ok: false, error: `Picks are locked — ${t.name} has already started.` });

  const list = readEntries();
  const e = list.find(x => x.email === lc(b.email));
  if (!e) return res.status(403).json({ ok: false, error: 'That email is not registered.' });

  const starters = Array.isArray(b.starters) ? b.starters.filter(Boolean) : [];
  const bench = Array.isArray(b.bench) ? b.bench.filter(Boolean) : [];
  const pick = (b.pick || '').trim();
  const pickScore = Math.round(Number(b.pickScore));
  if (starters.length !== 5) return res.status(400).json({ ok: false, error: 'Pick exactly 5 starters.' });
  if (bench.length !== 2) return res.status(400).json({ ok: false, error: 'Pick exactly 2 bench players.' });
  const all = [...starters, ...bench];
  if (new Set(all).size !== all.length) return res.status(400).json({ ok: false, error: 'No duplicate players.' });
  if (!pick) return res.status(400).json({ ok: false, error: 'Pick an outright winner.' });
  if (!Number.isFinite(pickScore)) return res.status(400).json({ ok: false, error: 'Enter the predicted winning score.' });

  e.picks = e.picks || {};
  e.picks[t.key] = { starters, bench, pick, pickScore, submittedAt: new Date().toISOString() };
  writeEntries(list);
  res.json({ ok: true, teamName: e.teamName });
});

// ---- Admin (gated to an admin email) ----
app.get('/api/entries', (req, res) => {
  if (!isAdminEmail(req.query.adminEmail)) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  res.json(readEntries().map(publicEntry));
});
app.post('/api/entries', (req, res) => {
  if (!isAdminEmail(req.body?.adminEmail)) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  const teamName = (req.body?.teamName || '').trim();
  const email = lc(req.body?.email);
  if (!teamName) return res.status(400).json({ ok: false, error: 'Team name is required.' });
  if (!email) return res.status(400).json({ ok: false, error: 'Email is required.' });
  const list = readEntries();
  if (list.some(x => x.email === email)) return res.status(409).json({ ok: false, error: 'That email is already registered.' });
  list.push(blankEntry(email, teamName, false));
  writeEntries(list);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8765;
app.listen(port, () => console.log(`U.S. Open Matrix pool running on ${port}`));
