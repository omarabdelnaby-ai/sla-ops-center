import { fetchFromScript } from "../../lib/api";
export default async function handler(req, res) {
  try {
    const data = await fetchFromScript("status");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}