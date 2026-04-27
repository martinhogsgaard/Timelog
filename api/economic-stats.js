// /api/economic-stats.js
// Henter fakturerede beløb fra e-conomic og cacher i Redis
// GET  /api/economic-stats?customer=123  → kundespecifik data live
// POST /api/economic-stats               → tving opdatering af dashboard cache

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

async function fetchAllPages(basePath) {
  let all = [];
  let page = 0;
  let url = basePath + (basePath.includes("?") ? "&" : "?") + "pagesize=100&skippages=0";
  while (url) {
    const d = await ecoReq(url);
    const batch = d.collection || [];
    all = all.concat(batch);
    url = null;
    if (d.pagination && d.pagination.nextPage) {
      url = d.pagination.nextPage.replace("https://restapi.e-conomic.com", "");
    } else if (batch.length === 100) {
      page++;
      url = basePath + (basePath.includes("?") ? "&" : "?") + "pagesize=100&skippages=" + page;
    }
  }
  return all;
}

// Hent totals for én bogført faktura individuelt
async function getBookedInvoiceData(bookedInvoiceNumber) {
  try {
    const d = await ecoReq("/invoices/booked/" + bookedInvoiceNumber);
    return {
      net: d.netAmount || 0,
      gross: d.grossAmount || 0,
      date: d.date || null
    };
  } catch(e) {
    return { net: 0, gross: 0, date: null };
  }
}

async function fetchCustomerInvoices(customerNumber) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  // Kladder
  let drafts = [];
  try {
    drafts = await fetchAllPages(
      "/invoices/drafts?filter=customer.customerNumber$eq:" + customerNumber
    );
  } catch(e) {}

  // Bogførte — hent liste, derefter individuelle beløb
  let bookedList = [];
  try {
    bookedList = await fetchAllPages(
      "/invoices/booked?filter=customer.customerNumber$eq:" + customerNumber
    );
  } catch(e) {}

  // Hent beløb parallelt
  const bookedFull = await Promise.all(
    bookedList.map(async function(inv) {
      const d = await getBookedInvoiceData(inv.bookedInvoiceNumber);
      return { date: d.date || inv.date, netAmount: d.net };
    })
  );

  const allInvoices = bookedFull.concat(drafts);

  function filterMonth(arr) {
    return arr.filter(function(inv) {
      if (!inv.date) return false;
      const d = new Date(inv.date + "T00:00:00");
      return d.getMonth() === curMonth && d.getFullYear() === curYear;
    });
  }
  function filterYear(arr) {
    return arr.filter(function(inv) {
      if (!inv.date) return false;
      return new Date(inv.date + "T00:00:00").getFullYear() === curYear;
    });
  }
  function sumNet(arr) {
    return arr.reduce(function(s, inv) { return s + (inv.netAmount || 0); }, 0);
  }

  return {
    customerNumber: String(customerNumber),
    month:       Math.round(sumNet(filterMonth(allInvoices))),
    year:        Math.round(sumNet(filterYear(allInvoices))),
    total:       Math.round(sumNet(allInvoices)),
    count:       allInvoices.length,
    bookedCount: bookedFull.length,
    draftCount:  drafts.length,
    updatedAt:   new Date().toISOString()
  };
}

async function fetchDashboardTotals() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  let bookedList = [];
  try { bookedList = await fetchAllPages("/invoices/booked"); } catch(e) {}

  const bookedFull = await Promise.all(
    bookedList.map(async function(inv) {
      const d = await getBookedInvoiceData(inv.bookedInvoiceNumber);
      return { date: d.date || inv.date, netAmount: d.net };
    })
  );

  let drafts = [];
  try { drafts = await fetchAllPages("/invoices/drafts"); } catch(e) {}

  const allInvoices = bookedFull.concat(drafts);

  function sumNet(arr) {
    return arr.reduce(function(s, inv) { return s + (inv.netAmount || 0); }, 0);
  }

  const monthInv = allInvoices.filter(function(inv) {
    if (!inv.date) return false;
    const d = new Date(inv.date + "T00:00:00");
    return d.getMonth() === curMonth && d.getFullYear() === curYear;
  });
  const yearInv = allInvoices.filter(function(inv) {
    if (!inv.date) return false;
    return new Date(inv.date + "T00:00:00").getFullYear() === curYear;
  });

  return {
    month: Math.round(sumNet(monthInv)),
    year:  Math.round(sumNet(yearInv)),
    total: Math.round(sumNet(allInvoices)),
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
    if (req.query.customer) {
      const data = await fetchCustomerInvoices(req.query.customer);
      return res.status(200).json(data);
    }

    if (req.method === "GET") {
      const cached = await redisGet(CACHE_KEY);
      if (cached) {
        const age = Date.now() - new Date(cached.updatedAt).getTime();
        if (age < CACHE_TTL * 1000) {
          return res.status(200).json(Object.assign({}, cached, { fromCache: true }));
        }
      }
      const data = await fetchDashboardTotals();
      await redisSet(CACHE_KEY, data, CACHE_TTL);
      return res.status(200).json(Object.assign({}, data, { fromCache: false }));
    }

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
