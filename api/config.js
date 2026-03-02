// api/config.js
// Sender APP_KEY sikkert til frontend så den kan autentificere mod proxy.
// APP_KEY er aldrig synlig i kildekoden - kun i Vercel environment variables.

export default function handler(req, res) {
  res.status(200).json({
    appKey: process.env.APP_KEY || ""
  });
}
