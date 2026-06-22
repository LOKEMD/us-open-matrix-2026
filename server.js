const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '128kb' }));

// ---- Tournaments (the four majors) ----
const TOURNAMENTS = [
  { key: 'theopen', name: 'The Open',        eventId: '401811957', fieldEventId: '401811957', fallbackFieldEventId: '401811952', locked: false, current: true,  status: 'Upcoming' },
  { key: 'usopen',  name: 'U.S. Open',       eventId: '401811952', fieldEventId: '401811952', locked: true, current: false, status: 'In progress' },
  { key: 'pga',     name: 'PGA Championship', eventId: '401811947', fieldEventId: '401811947', locked: true, current: false, status: 'Final' },
  { key: 'masters', name: 'Masters',         eventId: '401811941', fieldEventId: '401811941', locked: true, current: false, status: 'Final' }
];

const lc = s => (s || '').trim().toLowerCase();

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

// ---- Storage: Postgres when DATABASE_URL is set (prod), else a JSON file (local dev) ----
const USE_PG = !!process.env.DATABASE_URL;
let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
const ENTRIES_FILE = path.join(__dirname, 'entries.json');
const readFile = () => { try { return JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8')); } catch { return []; } };
const writeFile = list => fs.writeFileSync(ENTRIES_FILE, JSON.stringify(list, null, 2));
const rowToEntry = r => ({ email: r.email, teamName: r.team_name, isAdmin: r.is_admin, picks: r.picks || {} });
const blankEntry = (email, teamName, isAdmin, picks) => ({ email: lc(email), teamName, isAdmin: !!isAdmin, picks: picks || {} });

async function init() {
  if (USE_PG) {
    await pool.query(`CREATE TABLE IF NOT EXISTS entries(
      email text PRIMARY KEY,
      team_name text NOT NULL,
      is_admin boolean DEFAULT false,
      picks jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    )`);
  }
  for (const s of SEED) {
    if (!(await getEntry(s.email))) await addEntry(blankEntry(s.email, s.teamName, s.isAdmin, s.picks));
  }
}

async function getEntry(email) {
  email = lc(email);
  if (USE_PG) { const r = await pool.query('SELECT * FROM entries WHERE email=$1', [email]); return r.rows[0] ? rowToEntry(r.rows[0]) : null; }
  return readFile().find(e => e.email === email) || null;
}
async function listEntries() {
  if (USE_PG) { const r = await pool.query('SELECT * FROM entries ORDER BY team_name'); return r.rows.map(rowToEntry); }
  return readFile();
}
// insert only; returns false if the email already exists
async function addEntry(e) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO entries(email,team_name,is_admin,picks) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING`,
      [e.email, e.teamName, e.isAdmin, JSON.stringify(e.picks || {})]);
    return r.rowCount > 0;
  }
  const list = readFile();
  if (list.some(x => x.email === e.email)) return false;
  list.push(e); writeFile(list); return true;
}
// update an existing entry's picks for one tournament
async function savePicks(email, tkey, picks) {
  email = lc(email);
  if (USE_PG) {
    await pool.query(`UPDATE entries SET picks = jsonb_set(coalesce(picks,'{}'::jsonb), $2, $3::jsonb, true) WHERE email=$1`,
      [email, '{' + tkey + '}', JSON.stringify(picks)]);
    return;
  }
  const list = readFile(); const e = list.find(x => x.email === email);
  if (e) { e.picks = e.picks || {}; e.picks[tkey] = picks; writeFile(list); }
}
async function isAdminEmail(email) { const e = await getEntry(email); return !!(e && e.isAdmin); }

// ---- Email via Resend (set RESEND_API_KEY + MAIL_FROM as Heroku config vars) ----
const SITE_URL = process.env.SITE_URL || 'https://darttgolf-be6288e2b9b4.herokuapp.com';
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email is not configured yet (no RESEND_API_KEY).');
  const from = process.env.MAIL_FROM || 'Dartt Golf <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()));
  return res.json();
}
function inviteHtml(e) {
  const link = SITE_URL + '/submit?email=' + encodeURIComponent(e.email);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0d1b2a">
    <p>Hi <b>${(e.teamName||'').replace(/[<>&]/g,'')}</b>,</p>
    <p>You're in the 2026 Majors Pool. Make your picks for The Open here:</p>
    <p><a href="${link}" style="display:inline-block;background:#1a7f4b;color:#fff;font-weight:700;text-decoration:none;padding:11px 18px;border-radius:8px">Make your picks →</a></p>
    <p>Just log in with this email (<b>${e.email}</b>) — it's linked to your team. Pick 5 starters + 2 bench + an outright winner.</p>
    <p>See the live leaderboards any time at <a href="${SITE_URL}">${SITE_URL.replace(/^https?:\/\//,'')}</a>.</p>
    <p>Good luck!</p></div>`;
}

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ ok: false, error: e.message }); });

app.get('/api/tournaments', (_req, res) => res.json(TOURNAMENTS));

app.get('/api/entry', wrap(async (req, res) => {
  const e = await getEntry(req.query.email);
  if (!e) return res.status(404).json({ ok: false, error: 'No team is registered to that email. Check with the pool admin.' });
  res.json({ ok: true, entry: e });
}));

app.post('/api/submit', wrap(async (req, res) => {
  const b = req.body || {};
  const t = TOURNAMENTS.find(x => x.key === b.tournament);
  if (!t) return res.status(400).json({ ok: false, error: 'Unknown tournament.' });
  if (t.locked) return res.status(403).json({ ok: false, error: `Picks are locked — ${t.name} has already started.` });
  const e = await getEntry(b.email);
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

  await savePicks(e.email, t.key, { starters, bench, pick, pickScore, submittedAt: new Date().toISOString() });
  res.json({ ok: true, teamName: e.teamName });
}));

// ---- Admin (gated to an admin email) ----
app.get('/api/entries', wrap(async (req, res) => {
  if (!(await isAdminEmail(req.query.adminEmail))) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  res.json(await listEntries());
}));

app.post('/api/entries', wrap(async (req, res) => {
  if (!(await isAdminEmail(req.body?.adminEmail))) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  const teamName = (req.body?.teamName || '').trim();
  const email = lc(req.body?.email);
  if (!teamName) return res.status(400).json({ ok: false, error: 'Team name is required.' });
  if (!email) return res.status(400).json({ ok: false, error: 'Email is required.' });
  const added = await addEntry(blankEntry(email, teamName, false));
  if (!added) return res.status(409).json({ ok: false, error: 'That email is already registered.' });
  res.json({ ok: true });
}));

// Bulk register from pasted "Team Name, email" lines
app.post('/api/entries/bulk', wrap(async (req, res) => {
  if (!(await isAdminEmail(req.body?.adminEmail))) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  const lines = String(req.body?.text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0; const errors = [];
  for (const line of lines) {
    const m = line.split(/[,\t]/).map(x => x.trim());
    const email = lc(m.find(x => x.includes('@')) || '');
    const teamName = m.filter(x => !x.includes('@')).join(' ').trim();
    if (!email || !teamName) { errors.push(line); continue; }
    (await addEntry(blankEntry(email, teamName, false))) ? added++ : skipped++;
  }
  res.json({ ok: true, added, skipped, errors });
}));

// Send invite emails (to specific emails, or all registered if none given)
app.post('/api/invite', wrap(async (req, res) => {
  if (!(await isAdminEmail(req.body?.adminEmail))) return res.status(403).json({ ok: false, error: 'Admin access only.' });
  let targets = Array.isArray(req.body?.emails) ? req.body.emails.map(lc) : null;
  const all = await listEntries();
  const list = targets ? all.filter(e => targets.includes(e.email)) : all;
  let sent = 0; const failed = [];
  for (const e of list) {
    try { await sendEmail(e.email, "You're in — 2026 Majors Pool", inviteHtml(e)); sent++; }
    catch (err) { failed.push({ email: e.email, error: err.message }); }
  }
  res.json({ ok: failed.length === 0, sent, failed, emailConfigured: !!process.env.RESEND_API_KEY });
}));

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8765;
init()
  .then(() => app.listen(port, () => console.log(`Dartt Golf running on ${port} (${USE_PG ? 'postgres' : 'file'} storage)`)))
  .catch(e => { console.error('Init failed:', e); process.exit(1); });
