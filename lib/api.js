import { getCached, setCache } from './cache';

const SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwu_EWewvcKQ_gdlEYQR2KgWcumJnNJWftL6PJ7xa2_wZIh6oNjUkhJJQMsZdHY6T1wrQ/exec';

async function rawFetch(action, retries = 2) {
  const url = `${SCRIPT_URL}?action=${action}&t=${Date.now()}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { if (attempt === retries) throw err; await new Promise(r => setTimeout(r, 1000)); }
  }
}

export async function fetchFromScript(action) {
  const cacheKey = `script_${action}`;
  const cached = getCached(cacheKey);
  if (cached.fresh) return { ...cached.data, _cached: true, _age: cached.age };
  try {
    const data = await rawFetch(action);
    setCache(cacheKey, data);
    return { ...data, _cached: false };
  } catch (err) {
    if (cached.stale) return { ...cached.data, _cached: true, _stale: true, _age: cached.age };
    throw new Error(`Apps Script unreachable: ${err.message}`);
  }
}

export async function postToScript(action, payload) {
  const res = await fetch(SCRIPT_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
  return res.json();
}
```

**Ctrl+S** to save.

---

Now **push immediately**. Go to terminal and type:
```
git add .
```

Then:
```
git commit -m "v2 full upgrade"
```

Then:
```
git push origin main