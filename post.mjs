// Runs on GitHub every ~20 min: posts every due reel of schedule.enc to Instagram and records the result in state.enc.
// Never posts a job twice: a job that reached "publish" is done (or 'unknown'), never retried.
import fs from 'node:fs'; import { execSync, execFileSync } from 'node:child_process'; import { seal, open } from './crypt.mjs'; import { reachCheck } from './reach.mjs';
const { IG_TOKEN, IG_POSTER_KEY: KEY, TG_TOKEN, TG_CHAT } = process.env;
const G = 'https://graph.facebook.com/v21.0';
const sched = fs.existsSync('schedule.enc') ? open(fs.readFileSync('schedule.enc', 'utf8'), KEY) : { jobs: [], accounts: {} };
const state = fs.existsSync('state.enc') ? open(fs.readFileSync('state.enc', 'utf8'), KEY) : { jobs: {}, trial: {} };
const notes = [];
const save = () => fs.writeFileSync('state.enc', seal(state, KEY));
// before a publish the 'unknown' mark is pushed to GitHub, so even a crashed run can never publish the same job again
const checkpoint = () => { save(); if (process.env.CI) execSync('git add state.enc && (git diff --cached --quiet || git commit -qm checkpoint) && (git pull -q --rebase || true) && git push -q', { stdio: 'inherit' }); };
const api = async (method, path, params = {}) => {
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const r = await fetch(method === 'GET' ? `${G}/${path}?${body}` : `${G}/${path}`, method === 'GET' ? {} : { method, body });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now(), LATE = 6 * 3600e3;
if (process.env.SELFTEST) { const u = sched.jobs[0]?.videoUrl; fs.writeFileSync('in.mp4', Buffer.from(await (await fetch(u)).arrayBuffer()));
  execFileSync('python3', ['render.py', 'in.mp4', 'out.mp4', 'pov: you finally met me in person', '3'], { stdio: 'inherit' }); console.log('selftest render ok', fs.statSync('out.mp4').size); process.exit(0); }
for (const j of sched.jobs.sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
  const s = (state.jobs[j.id] ||= { tries: 0 });
  if (s.status === 'posted' || s.status === 'unknown' || s.status === 'failed' || s.status === 'missed') continue;
  const due = Date.parse(j.dueAt);
  if (due > now) continue;
  if (now - due > LATE) { s.status = 'missed'; notes.push(`⏰ @${j.account} ${j.label}: missed its slot by more than 6 h — not posted`); continue; }
  const igId = sched.accounts[j.account]; if (!igId) continue;
  s.tries++;
  const params = { media_type: 'REELS', video_url: j.videoUrl, caption: j.caption || '', share_to_feed: 'true' };
  if (j.trial) params.trial_params = JSON.stringify({ graduation_strategy: j.trial.toUpperCase() });
  let c = {};
  try {
    if (j.overlay) { // trial copy: draw its hook, upload the file itself (no public link for the new version)
      const v = Buffer.from(await (await fetch(j.videoUrl)).arrayBuffer()); fs.writeFileSync('in.mp4', v);
      execFileSync('python3', ['render.py', 'in.mp4', 'out.mp4', j.overlay.text, String(j.overlay.style)], { stdio: 'inherit' });
      delete params.video_url; params.upload_type = 'resumable';
      c = await api('POST', `${igId}/media`, params);
      if (c.id) { const f = fs.readFileSync('out.mp4');
        const u = await (await fetch(c.uri || `https://rupload.facebook.com/ig-api-upload/v21.0/${c.id}`, { method: 'POST', headers: { Authorization: `OAuth ${IG_TOKEN}`, offset: '0', file_size: String(f.length) }, body: f })).json();
        if (!u.success) c = { error: { message: `upload refused: ${JSON.stringify(u).slice(0, 150)}` } }; }
    } else c = await api('POST', `${igId}/media`, params);
  } catch (e) { c = { error: { message: String(e).slice(0, 200) } }; }
  if (!c.id) { s.last = c.error?.error_user_msg || c.error?.message || JSON.stringify(c).slice(0, 200); if (s.tries >= 3) { s.status = 'failed'; notes.push(`❌ @${j.account} ${j.label}: ${s.last}`); } continue; }
  let st = '';
  for (let i = 0; i < 30; i++) { await sleep(10e3); try { st = (await api('GET', c.id, { fields: 'status_code' })).status_code; } catch { st = ''; } if (st === 'FINISHED' || st === 'ERROR' || st === 'EXPIRED') break; }
  if (st !== 'FINISHED') { s.last = `video processing ${st || 'timed out'}`; if (s.tries >= 3) { s.status = 'failed'; notes.push(`❌ @${j.account} ${j.label}: ${s.last}`); } continue; }
  s.status = 'unknown'; s.at = new Date().toISOString(); checkpoint(); // from here on: never publish again by itself
  let p = {}; try { p = await api('POST', `${igId}/media_publish`, { creation_id: c.id }); } catch (e) { p = { error: { message: String(e) } }; }
  if (p.id) { const m = await api('GET', p.id, { fields: 'permalink' }); s.status = 'posted'; s.media = p.id; s.link = m.permalink || ''; notes.push(`✅ @${j.account} ${j.label}${j.trial ? ' (trial)' : ''} ${s.link}`); }
  else { s.last = p.error?.error_user_msg || p.error?.message || 'publish answer unclear'; notes.push(`⚠️ @${j.account} ${j.label}: publish unclear (${s.last}) — check the profile, it is NOT retried`); }
}
// Once a day per account: can it make trial reels yet? (a container is created and never published)
const today = new Date().toISOString().slice(0, 10);
for (const [acct, igId] of Object.entries(sched.accounts)) {
  const t = (state.trial[acct] ||= {});
  if (t.ok || t.checked === today) continue;
  t.checked = today;
  const probe = sched.jobs.find((j) => j.account === acct)?.videoUrl; if (!probe) continue;
  let c = {}; try { c = await api('POST', `${igId}/media`, { media_type: 'REELS', video_url: probe, trial_params: JSON.stringify({ graduation_strategy: 'MANUAL' }) }); } catch {}
  if (c.id) { t.ok = today; notes.push(`🧪 @${acct} can now post TRIAL reels — the 12-a-night trials can start`); }
}
try { await reachCheck({ sched, state, api, notes }); } catch (e) { console.log('reach check failed', String(e)); }
save();
if (notes.length && TG_TOKEN) await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TG_CHAT, text: `Instagram poster:\n${notes.join('\n')}`, disable_web_page_preview: true }) });
console.log(notes.length ? `${notes.length} event(s)` : 'nothing due');
