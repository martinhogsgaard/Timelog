// /api/economic-stats.js
// Henter fakturerede beløb fra e-conomic og cacher i Redis
// GET  /api/economic-stats?customer=123  → kundespecifik data live
// GET  /api/economic-stats?totals=1      → dashboard totaler (cached 24h)
// POST /api/economic-stats               → tving opdatering af cache

const REDIS_URL       = process.env.KV_REST_API_URL;
const REDIS_TOKEN     = process.env.KV_REST_API_TOKEN;
const APP_KEY         = process.env.APP_KEY;
const APP_SECRET      = process.env.ECONOMIC_APP_SECRET;
const AGREEMENT_TOKEN = process.env.ECONOMIC_AGREEMENT_TOKEN;
const CACHE_KEY       = "timelog:economic-stats";
const CACHE_TTL       = 86400; // 24 timer

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

async function redisSet(key, value, ttl) {
  await redisCmd(["SET", key, JSON.stringify(value), "EX", ttl]);
}

async function ecoReq(path) {
  const url = "https://restapi.e-conomic.com" + path;
  const res = await fetch(url, {
    headers: {
      "X-AppSecretToken": APP_SECRET,
      "X-AgreementGrantToken": AGREEMENT_TOKEN,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "HTTP " + res.status);
  }
  return res.json();
}

// Hent alle sider fra et e-conomic endpoint
async function fetchAllPages(basePath) {
  let all = [];
  let url = basePath + (basePath.includes("?") ? "&" : "?") + "pagesize=100&skippages=0";
  while (url) {
    const d = await ecoReq(url);
    const batch = d.collection || [];
    all = all.concat(batch);
    url = null;
    if (d.pagination && d.pagination.nextPage) {
      url = d.pagination.nextPage.replace("https://restapi.e-conomic.com", "");
    } else if (batch.length === 100) {
      // Manuel pagination fallback
      const skip = Math.floor(all.length / 100);
      url = basePath + (basePath.includes("?") ? "&" : "?") + "pagesize=100&skippages=" + skip;
    }
  }
  return all;
}

// Beregn totaler fra en liste af fakturaer
function sumInvoices(invoices) {
  return invoices.reduce(function(s, inv) {
    return s + (inv.netAmount || inv.grossAmount || 0);
  }, 0);
}

// Hent alle bogførte + kladde fakturaer for én kunde
async function fetchCustomerInvoices(customerNumber) {
  const curYear = new Date().getFullYear();

  // Bogførte fakturaer
  let booked = [];
  try {
    booked = await fetchAllPages(
      "/invoices/booked?filter=customer.customerNumber$eq:" + customerNumber
    );
  } catch(e) { /* ignorer fejl */ }

  // Kladder
  let drafts = [];
  try {
    drafts = await fetchAllPages(
      "/invoices/drafts?filter=customer.customerNumber$eq:" + customerNumber
    );
  } catch(e) { /* ignorer fejl */ }

  const allInvoices = booked.concat(drafts);
  const now = new Date();
  const curMonth = now.getMonth();

  const monthInvoices = allInvoices.filter(function(inv) {
    const d = new Date(inv.date + "T00:00:00");
    return d.getMonth() === curMonth && d.getFullYear() === curYear;
  });
  const yearInvoices = allInvoices.filter(function(inv) {
    return new Date(inv.date + "T00:00:00").getFullYear() === curYear;
  });

  return {
    customerNumber: customerNumber,
    month:  Math.round(sumInvoices(monthInvoices)),
    year:   Math.round(sumInvoices(yearInvoices)),
    total:  Math.round(sumInvoices(allInvoices)),
    count:  allInvoices.length,
    updatedAt: new Date().toISOString()
  };
}

// Hent totaler på tværs af alle kunder (til dashboard)
async function fetchDashboardTotals() {
  const curYear = new Date().getFullYear();
  const now = new Date();
  const curMonth = now.getMonth();

  let booked = [];
  let drafts = [];
  try { booked = await fetchAllPages("/invoices/booked"); } catch(e) {}
  try { drafts = await fetchAllPages("/invoices/drafts"); } catch(e) {}

  const allInvoices = booked.concat(drafts);

  const monthInv = allInvoices.filter(function(inv) {
    const d = new Date(inv.date + "T00:00:00");
    return d.getMonth() === curMonth && d.getFullYear() === curYear;
  });
  const yearInv = allInvoices.filter(function(inv) {
    return new Date(inv.date + "T00:00:00").getFullYear() === curYear;
  });

  return {
    month: Math.round(sumInvoices(monthInv)),
    year:  Math.round(sumInvoices(yearInv)),
    total: Math.round(sumInvoices(allInvoices)),
    updatedAt: new Date().toISOString()
  };
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

  try {
    // Kundespecifik data — altid live
    if (req.query.customer) {
      const data = await fetchCustomerInvoices(req.query.customer);
      return res.status(200).json(data);
    }

    // Dashboard totaler — brug cache hvis frisk
    if (req.query.totals || req.method === "GET") {
      const cached = await redisGet(CACHE_KEY);
      if (cached && req.method === "GET") {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        if (age < CACHE_TTL * 1000) {
          return res.status(200).json(Object.assign({}, cached, { fromCache: true }));
        }
      }
      // Hent friske data
      const data = await fetchDashboardTotals();
      await redisSet(CACHE_KEY, data, CACHE_TTL);
      return res.status(200).json(Object.assign({}, data, { fromCache: false }));
    }

    // POST = tving cache-opdatering
    if (req.method === "POST") {
      const data = await fetchDashboardTotals();
      await redisSet(CACHE_KEY, data, CACHE_TTL);
      return res.status(200).json(Object.assign({}, data, { fromCache: false, refreshed: true }));
    }

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
