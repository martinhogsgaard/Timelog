// api/init.js — returnerer APP_KEY til klienten
// Denne endpoint er rate-limited og returnerer kun nøglen
// Dette er IKKE /api/config — den gamle config endpoint skal slettes fra GitHub

const APP_KEY = process.env.APP_KEY;
const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

// Simpel rate limiting via Redis — max 60 kald per IP per time
async function checkRateLimit(ip) {
  if (!REDIS_URL || !REDIS_TOKEN) return true; // Hvis Redis ikke er klar, tillad
  try {
    const key = `rl:init:${ip}`;
    const res = await fetch(REDIS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["INCR", key])
    });
    const data = await res.json();
    const count = data.result;
    if (count === 1) {
      // Sæt TTL på 1 time ved første kald
      await fetch(REDIS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["EXPIRE", key, 3600])
      });
    }
    return count <= 60;
  } catch (e) {
    return true; // Ved fejl, tillad
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return res.status(429).json({ error: "Too many requests" });
  }

  // Returner kun nøglen — ingen andre data
  return res.status(200).json({ k: APP_KEY || "" });
}
