// api/distance.js
// Beregner afstand i km mellem to adresser via Google Maps Distance Matrix API

export default async function handler(req, res) {
  const appKey = req.headers["x-app-key"];
  if (!appKey || appKey !== process.env.APP_KEY) {
    return res.status(401).json({ message: "Uautoriseret" });
  }

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ message: "from og to påkrævet" });

  try {
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json"
      + "?origins=" + encodeURIComponent(from)
      + "&destinations=" + encodeURIComponent(to)
      + "&key=" + process.env.GOOGLE_MAPS_API_KEY
      + "&language=da&region=dk&mode=driving&units=metric";

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({ message: "Google Maps fejl: " + data.status });
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      return res.status(400).json({ message: "Kunne ikke beregne afstand mellem adresserne" });
    }

    // Afstand i meter → km rundet til 1 decimal
    const meters = element.distance.value;
    const km = Math.round(meters / 100) / 10;
    const durationMin = Math.round(element.duration.value / 60);

    return res.status(200).json({
      km: km,
      durationMin: durationMin,
      fromAddress: data.origin_addresses[0],
      toAddress: data.destination_addresses[0]
    });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
