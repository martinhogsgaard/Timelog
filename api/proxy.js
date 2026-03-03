// /api/proxy.js — videresender requests til e-conomic REST API
// Beskyttet af APP_KEY + rate limiting

const APP_SECRET    = process.env.ECONOMIC_APP_SECRET;
const AGREEMENT_TOKEN = process.env.ECONOMIC_AGREEMENT_TOKEN;
const APP_KEY       = process.env.APP_KEY;
const REDIS_URL     = process.env.KV_REST_API_URL;
const REDIS_TOKEN   = process.env.KV_REST_API_TOKEN;
const BASE_URL      = "https://restapi.e-conomic.com";

async function redisCmd(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) return { result: null };
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  return res.json();
}

async function checkRateLimit(ip) {
  try {
    const key = `rl:proxy:${ip}`;
    const data = await redisCmd(["INCR", key]);
    const count = data.result || 0;
    if (count === 1) await redisCmd(["EXPIRE", key, 3600]);
    return count <= 200; // max 200 e-conomic kald per IP per time
  } catch (e) { return true; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Auth
  const appKey = req.headers["x-app-key"];
  if (APP_KEY && appKey !== APP_KEY) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Rate limit
  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const allowed = await checkRateLimit(ip);
  if (!allowed) return res.status(429).json({ message: "Too many requests — prøv igen om lidt" });

  const { path, method, body } = req.body || {};
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    return res.status(400).json({ message: "Ugyldig path" });
  }

  // Bloker farlige HTTP metoder
  const allowedMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
  const upperMethod = (method || "GET").toUpperCase();
  if (!allowedMethods.includes(upperMethod)) {
    return res.status(400).json({ message: "Ikke tilladt metode" });
  }

  try {
    const opts = {
      method: upperMethod,
      headers: {
        "Content-Type": "application/json",
        "X-AppSecretToken": APP_SECRET || "",
        "X-AgreementGrantToken": AGREEMENT_TOKEN || ""
      }
    };
    if (body && upperMethod !== "GET") opts.body = JSON.stringify(body);

    const upstream = await fetch(BASE_URL + path, opts);
    if (upstream.status === 204) return res.status(204).end();

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
