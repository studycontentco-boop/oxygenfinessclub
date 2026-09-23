const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const FACILITY_IMAGES = {
  strength:            { file: 'gym-sequence/ezgif-frame-062.jpg', label: 'STRENGTH TRAINING' },
  free_weights:        { file: 'gym-sequence/ezgif-frame-091.jpg', label: 'FREE WEIGHTS' },
  cardio:              { file: 'gym-sequence/ezgif-frame-031.jpg', label: 'CARDIO' },
  functional_training: { file: 'gym-sequence/ezgif-frame-181.jpg', label: 'FUNCTIONAL TRAINING' },
  training_environment:{ file: 'gym-sequence/ezgif-frame-211.jpg', label: 'TRAINING ENVIRONMENT' },
};

async function request(table, method, query, body, prefer) {
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: 'Bearer ' + SERVICE_ROLE,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  if (query) headers.Prefer = 'resolution=merge-duplicates';
  const url = SUPABASE_URL + '/rest/v1/' + table + (query || '');
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(table + ' ' + method + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

(async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
    console.error('PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; node supabase/seed.js');
    process.exit(1);
  }

  const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8'));
  await request('content', 'POST', '?on_conflict=id', [
    { id: 1, payload: content, updated_at: new Date().toISOString() },
  ]);
  console.log('content: upserted 1 row (id=1)');

  const list = Object.entries(FACILITY_IMAGES).map(([key, v]) => {
    const full = path.join(ROOT, v.file);
    let size = 0, updated = null;
    if (fs.existsSync(full)) {
      const st = fs.statSync(full);
      size = st.size;
      updated = st.mtime.toISOString();
    }
    return { key, label: v.label, file: v.file, replaced: false, replaced_name: null, size, updated };
  });
  await request('facilities', 'POST', '?on_conflict=key', list);
  console.log('facilities: upserted ' + list.length + ' rows');

  const msgFile = path.join(ROOT, 'messages.json');
  let messages = [];
  try { messages = JSON.parse(fs.readFileSync(msgFile, 'utf8')); } catch {}
  if (!Array.isArray(messages)) messages = [];
  if (messages.length) {
    await request('messages', 'POST', '', messages.map(m => ({
      name: m.name, phone: m.phone || '', message: m.message,
      at: m.at ? new Date(m.at).toISOString() : new Date().toISOString(),
      read: !!m.read,
    })));
    console.log('messages: inserted ' + messages.length + ' rows');
  } else {
    console.log('messages: none to seed');
  }

  console.log();
  console.log('Seed complete. Next:');
  console.log('1) Authentication -> Users -> Add user -> create your admin email + password');
  console.log('2) Copy supabase-config.example.js to supabase-config.js and paste Project URL + anon key');
  console.log('3) Deploy to Cloudflare Pages (see SUPABASE_URL env -> Functions secret SUPABASE_ANON_KEY)');
})().catch(e => { console.error(e.message); process.exit(1); });