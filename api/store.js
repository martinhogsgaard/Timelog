// /api/store.js — læser og skriver app-data til Redis
// GET  /api/store  → { entries, customers, settings }
// POST /api/store  → merger og gemmer

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;
const APP_KEY     = process.env.APP_KEY;
const STORE_KEY   = "timelog:data";

async function redisCmd(cmd) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  return res.json();
}

async function redisGet(key) {
  const data = await redisCmd(["GET", key]);
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value) {
  await redisCmd(["SET", key, JSON.stringify(value)]);
}

async function checkRateLimit(ip, max, ttl) {
  if (!REDIS_URL || !REDIS_TOKEN) return true;
  try {
    const key = `rl:store:${ip}`;
    const data = await redisCmd(["INCR", key]);
    const count = data.result;
    if (count === 1) await redisCmd(["EXPIRE", key, ttl]);
    return count <= max;
  } catch (e) { return true; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  const appKey = req.headers["x-app-key"];
  if (APP_KEY && appKey !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const allowed = await checkRateLimit(ip, 120, 3600);
  if (!allowed) return res.status(429).json({ error: "Too many requests" });

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: "Redis ikke konfigureret" });
  }

  if (req.method === "GET") {
    try {
      const data = await redisGet(STORE_KEY);
      return res.status(200).json(data || { entries: [], customers: [], settings: {} });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const existing = await redisGet(STORE_KEY) || { entries: [], customers: [], settings: {} };
      const body = req.body;
      if (body.entries   !== undefined) existing.entries   = body.entries;
      if (body.customers !== undefined) existing.customers = body.customers;
      if (body.settings  !== undefined) existing.settings  = Object.assign({}, existing.settings, body.settings);
      await redisSet(STORE_KEY, existing);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
