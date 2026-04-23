export default async function handler(req, res) {
  return res.status(200).json({
    message: "Het werkt!",
    timestamp: new Date().toISOString()
  });
}
