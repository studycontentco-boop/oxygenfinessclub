const KEY_BY_FILE = {
  'gym-sequence/ezgif-frame-062.jpg': 'strength',
  'gym-sequence/ezgif-frame-091.jpg': 'free_weights',
  'gym-sequence/ezgif-frame-031.jpg': 'cardio',
  'gym-sequence/ezgif-frame-181.jpg': 'functional_training',
  'gym-sequence/ezgif-frame-211.jpg': 'training_environment',
};

export async function onRequest(context) {
  const { request, env } = context;
  const pathname = new URL(request.url).pathname;
  const rel = pathname.replace(/^\//, '');
  const key = KEY_BY_FILE[rel];
  if (!key) return env.ASSETS.fetch(request);

  try {
    const url = env.SUPABASE_URL + '/rest/v1/facilities?key=eq.' + key + '&select=replaced,replaced_name';
    const res = await fetch(url, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return env.ASSETS.fetch(request);
    const rows = await res.json();
    const row = Array.isArray(rows) && rows[0];
    if (row && row.replaced && row.replaced_name) {
      const obj = await fetch(env.SUPABASE_URL + '/storage/v1/object/public/facility-images/' + row.replaced_name);
      if (obj.ok) {
        const headers = new Headers();
        headers.set('Content-Type', obj.headers.get('Content-Type') || 'image/jpeg');
        headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
        return new Response(obj.body, { status: 200, headers });
      }
    }
  } catch {
    return env.ASSETS.fetch(request);
  }

  return env.ASSETS.fetch(request);
}