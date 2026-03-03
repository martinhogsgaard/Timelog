// api/geocode.js
// GET /api/geocode?lat=xx&lng=xx  → konverterer GPS til adresse
// GET /api/geocode?q=søgetekst    → returnerer adresseforslag

export default async function handler(req, res) {
  const appKey = req.headers["x-app-key"];
  if (!appKey || appKey !== process.env.APP_KEY) {
    return res.status(401).json({ message: "Uautoriseret" });
  }

  const { lat, lng, q } = req.query;

  // ── Adresseforslag ────────────────────────────────────────────
  if (q) {
    if (q.length < 2) return res.status(200).json({ suggestions: [] });
    try {
      const url = "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=" + encodeURIComponent(q) + "&types=address&components=country:dk&language=da&key=" + process.env.GOOGLE_MAPS_API_KEY;
      const response = await fetch(url);
      const data = await response.json();
      const suggestions = (data.predictions || []).map(function(p) {
        // Fjern ", Danmark" fra slutningen
        return p.description.replace(/, Danmark$/, "").replace(/, Denmark$/, "");
      });
      return res.status(200).json({ suggestions });
    } catch (err) {
      return res.status(200).json({ suggestions: [] });
    }
  }

  // ── GPS → adresse ─────────────────────────────────────────────
  if (!lat || !lng) return res.status(400).json({ message: "lat/lng eller q påkrævet" });
  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng + "&key=" + process.env.GOOGLE_MAPS_API_KEY + "&language=da&region=dk";
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== "OK" || !data.results[0]) {
      return res.status(400).json({ message: "Kunne ikke finde adresse for placering" });
    }
    const full = data.results[0].formatted_address;
    const clean = full.replace(/, Danmark$/, "").replace(/, Denmark$/, "");
    return res.status(200).json({ address: clean });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
