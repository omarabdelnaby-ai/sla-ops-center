import { postToScript, fetchFromScript } from "../../lib/api";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { type, message } = req.body;
  try {
    let result;
    if (type === "run")        result = await fetchFromScript("run");
    else if (type === "email") result = await postToScript("triggerAlert", {});
    else if (type === "chat")  result = await postToScript("triggerChat", { message });
    else result = { error: "Unknown trigger type" };
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}