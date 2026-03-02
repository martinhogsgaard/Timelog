// api/geocode.js
// Konverterer GPS koordinater til en læsbar adresse via Google Maps

export default async function handler(req, res) {
  const appKey = req.headers["x-app-key"];
  if (!appKey || appKey !== process.env.APP_KEY) {
    return res.status(401).json({ message: "Uautoriseret" });
  }

  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ message: "lat og lng påkrævet" });

  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng + "&key=" + process.env.GOOGLE_MAPS_API_KEY + "&language=da&region=dk";
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" || !data.results[0]) {
      return res.status(400).json({ message: "Kunne ikke finde adresse for placering" });
    }

    // Brug den første adresse og forenkl den
    const full = data.results[0].formatted_address;
    // Fjern "Danmark" fra slutningen
    const clean = full.replace(/, Danmark$/, "").replace(/, Denmark$/, "");

    return res.status(200).json({ address: clean });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
