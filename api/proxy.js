export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN || "";
  if (allowed && origin && !origin.endsWith(allowed)) {
    return res.status(403).json({ message: "Ikke tilladt" });
  }

  if (req.method !== "POST") return res.status(405).end();

  const appKey = req.headers["x-app-key"];
  if (!appKey || appKey !== process.env.APP_KEY) {
    return res.status(401).json({ message: "Uautoriseret" });
  }

  const { path, method = "GET", body } = req.body;
  if (!path || !path.startsWith("/")) return res.status(400).json({ message: "Ugyldig path" });

  const allowed_paths = ["/customers", "/invoices/drafts", "/products", "/invoices/drafts/"];
  const pathOk = allowed_paths.some(function(p){ return path.startsWith(p); });
  if (!pathOk) return res.status(400).json({ message: "Endpoint ikke tilladt" });

  try {
    const response = await fetch("https://restapi.e-conomic.com" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-AppSecretToken": process.env.ECONOMIC_APP_SECRET || "",
        "X-AgreementGrantToken": process.env.ECONOMIC_AGREEMENT_TOKEN || "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) return res.status(204).end();
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
