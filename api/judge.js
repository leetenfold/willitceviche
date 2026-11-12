// Vercel serverless function: asks Claude whether a thing will ceviche.
// Needs ANTHROPIC_API_KEY set in the Vercel project.
const cache = new Map();           // warm-instance cache; CDN cache does the heavy lifting
const hits = new Map();            // naive per-IP rate limit
const LIMIT = 20;                  // questions per IP per 10 minutes

const PROMPT = q => `You are the judge for willitceviche, a deadpan yes/no website. Someone asked about: "${q}"

Decide whether that thing will ceviche, meaning cured raw in lime juice and eaten. Be factually correct about food safety, biology, law and conservation, and funny in a dry, British, one-liner way.

Verdicts:
- "yes": it swims in the sea, lives in a shell, or is a firm fruit/veg that works in vegan ceviche.
- "if": works only under a real condition (frozen first for river fish and parasites, sustainably caught, already dead, legal where you are). Say the condition.
- "probably": plausible but dodgy, unusual or untested.
- "no": land meat and poultry (pathogens), dairy, already-cooked food, anything toxic, endangered or protected, pets, people, objects, vehicles, electronics, concepts.
- "is": it is ceviche, lime, or leche de tigre.

Rules to cite (number only): 1 swam in the sea, yes. 2 swam in a river, yes once frozen. 3 lived in a shell, yes. 4 mammal that swims, yes if. 5 walked on land, no. 6 flew, probably. 7 firm fruit or veg, yes. 8 engine, plug or feeling, no. Use 0 if none fits.

Mass: if the person gave a weight or count, use it. Otherwise if the thing comes as one whole item (an animal, a vehicle, an object) use a real typical adult or standard mass for one, in grams. Otherwise use 150 (a starter portion). Be accurate.

Reply with JSON only, no fences:
{"thing":"short name of the thing","verdict":"yes|no|probably|if|is","reason":"one or two sentences, max 30 words, no em dashes","rule":0-8,"grams":number,"basis":"what the mass is, e.g. 'an adult giraffe, about 800kg' or 'a 150g starter portion' or '2kg'","noun":"one-word noun for the thing, e.g. 'giraffe'","whole":true|false}`;

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: "no question" });
  const key = q.toLowerCase().replace(/\s+/g, " ");

  if (cache.has(key)) {
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=86400");
    return res.status(200).json(cache.get(key));
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "slow down" });
  recent.push(now); hits.set(ip, recent);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.CEVICHE_MODEL || "claude-haiku-5-5",
        max_tokens: 300,
        messages: [{ role: "user", content: PROMPT(q) }]
      })
    });
    if (!r.ok) return res.status(502).json({ error: "claude unavailable" });
    const data = await r.json();
    const text = (data.content || []).map(c => c.text || "").join("");
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (cache.size > 5000) cache.clear();
    cache.set(key, j);
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=86400");
    return res.status(200).json(j);
  } catch (e) {
    return res.status(502).json({ error: "claude unavailable" });
  }
}
