import { NextResponse } from "next/server";
const LLM_BASE = process.env.LLM_BASE || "http://minibelto.duckdns.org:8007";
const LLM_MODEL = process.env.LLM_MODEL || "local";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { text, prompt } = await req.json();
    if (!text || !prompt) return NextResponse.json({ error: "Missing 'text' or 'prompt'." }, { status: 400 });
    const clipped = String(text).trim().slice(0, 8000);

    const sys = `You are CASTINGPODS. Produce a single JSON array of exactly 3 utterances. Speakers: "Guide", "Skeptic", "Synthesizer".
Rules:
- Use ONLY info from the Context. If not present, one of the speakers must say exactly: "I can't find that in the provided text."
- Be concise but natural. Each utterance 1–3 sentences. No markdown, no extra commentary. Output JSON only.`;

    const fullPrompt = `${sys}

Context:
"""${clipped}"""

User prompt: ${prompt}

JSON format example:
[
  {"speaker":"Guide","text":"..."},
  {"speaker":"Skeptic","text":"..."},
  {"speaker":"Synthesizer","text":"..."}
]`;

    const res = await fetch(`${LLM_BASE}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: LLM_MODEL, prompt: fullPrompt, max_tokens: 500, temperature: 0.2 })
    });
    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `Upstream ${res.status}: ${raw}` }, { status: 502 });
    }
    const data = await res.json();
    let raw = (data?.choices?.[0]?.text || "").trim();

    // Try to extract the JSON array safely
    const match = raw.match(/\[[\s\S]*\]/);
    const json = match ? match[0] : raw;
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length !== 3) throw new Error("Bad dialogue shape");
    return NextResponse.json({ dialogue: arr });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
