export default async function handler(req, res) {
  const appKey = req.headers["x-app-key"];
  const serverKey = process.env.APP_KEY;
  if (serverKey && appKey !== serverKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const q = req.query.q;
  if (!q || q.length < 2) {
    return res.status(400).json({ suggestions: [] });
  }

  try {
    const url = `https://api.dataforsyningen.dk/autocomplete?q=${encodeURIComponent(q)}&type=adresse&caretpos=${q.length}&fuzzy=`;
    const response = await fetch(url);
    const data = await response.json();

    const suggestions = data
      .map(d => d.tekst)
      .slice(0, 6);

    return res.status(200).json({ suggestions });
  } catch (e) {
    return res.status(500).json({ error: e.message, suggestions: [] });
  }
}
