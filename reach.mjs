// Warning sign for "can't be recommended" (the flag itself is not in the API): every ~2 h, compare each account's
// reach from NON-followers over the last 24 h with its usual daily reach (median of the 7 days before).
// Collapse (< 20 % of usual while it is posting) → ⚠️ in Telegram, at most every 12 h; back above 50 % → 🟢.
export async function reachCheck({ sched, state, api, notes }) {
  const r = (state.reach ||= {}); const now = Date.now();
  if (r._at && now - Date.parse(r._at) < 110 * 60e3) return;
  r._at = new Date(now).toISOString();
  const t = Math.floor(now / 1000);
  for (const [acct, igId] of Object.entries(sched.accounts)) {
    const a = (r[acct] ||= {});
    try {
      const nf = await api('GET', `${igId}/insights`, { metric: 'reach', period: 'day', metric_type: 'total_value', breakdown: 'follow_type', since: String(t - 86400), until: String(t) });
      const res = nf.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const non = res.find((x) => x.dimension_values?.[0] === 'NON_FOLLOWER')?.value ?? 0;
      const wk = await api('GET', `${igId}/insights`, { metric: 'reach', period: 'day', since: String(t - 8 * 86400), until: String(t - 86400) });
      const vals = (wk.data?.[0]?.values || []).map((v) => v.value).sort((x, y) => x - y);
      const usual = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
      const media = await api('GET', `${igId}/media`, { fields: 'timestamp', limit: '1' });
      const lastPost = Date.parse(media.data?.[0]?.timestamp || 0);
      const posting = now - lastPost < 48 * 3600e3 && now - lastPost > 6 * 3600e3; // a fresh post needs ~6 h before its reach means anything
      a.non = non; a.usual = usual; a.checked = r._at;
      if (usual < 100 || !posting) continue; // too little to judge, or nothing posted lately
      const low = non < usual * 0.2;
      if (low && (!a.warned || now - Date.parse(a.warned) > 12 * 3600e3)) {
        notes.push(`⚠️ @${acct}: reach from non-followers collapsed — ${non} in the last 24 h vs about ${usual}/day usually. It may not be recommended right now: check Account Status in the app.`);
        a.warned = r._at; a.low = true;
      } else if (!low && a.low && non >= usual * 0.5) { notes.push(`🟢 @${acct}: non-follower reach is back (${non} in 24 h).`); a.low = false; a.warned = null; }
    } catch (e) { a.error = String(e).slice(0, 120); }
  }
}
