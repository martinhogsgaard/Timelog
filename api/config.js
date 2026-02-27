export default function handler(req, res) {
  res.status(200).json({
    appKey: process.env.APP_KEY || ""
  });
}
