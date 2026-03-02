// api/scan.js
// Modtager et faktura-billede og sender det til Claude AI.
// Claude læser leverandør, dato, beløb og beskrivelse fra fakturaen.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Tjek app-nøgle
  const appKey = req.headers["x-app-key"];
  if (!appKey || appKey !== process.env.APP_KEY) {
    return res.status(401).json({ message: "Uautoriseret" });
  }

  const { imageData } = req.body;
  if (!imageData) return res.status(400).json({ message: "Intet billede modtaget" });

  // Find billedformat (jpeg/png/heic/webp)
  let mediaType = "image/jpeg";
  if (imageData.startsWith("/9j/")) mediaType = "image/jpeg";
  else if (imageData.startsWith("iVBOR")) mediaType = "image/png";
  else if (imageData.startsWith("UklGR")) mediaType = "image/webp";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageData,
                },
              },
              {
                type: "text",
                text: `Analyser denne faktura og udtræk følgende information. Svar KUN med valid JSON, ingen forklaring, ingen markdown.

Returner dette JSON format:
{
  "supplier": "leverandørens navn",
  "date": "YYYY-MM-DD format (fakturadato)",
  "amount": 1234.56,
  "description": "kort beskrivelse af hvad fakturaen dækker (max 60 tegn)"
}

Regler:
- amount skal være beløbet EX. moms som et tal (ikke string)
- Hvis du ikke kan finde beløbet ex. moms, brug totalbeløbet
- date skal være i YYYY-MM-DD format
- Hvis du ikke kan læse en værdi, brug null
- description skal være på dansk og kortfattet`
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || "Claude API fejl: HTTP " + response.status);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";

    // Parse JSON fra Claude's svar
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({
      supplier:    parsed.supplier    || "",
      date:        parsed.date        || new Date().toISOString().split("T")[0],
      amount:      parsed.amount      || 0,
      description: parsed.description || "",
    });

  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ message: err.message });
  }
}
