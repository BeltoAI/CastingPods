import { NextResponse } from "next/server";

const LLM_BASE = process.env.LLM_BASE || "http://minibelto.duckdns.org:8007";
const LLM_MODEL = process.env.LLM_MODEL || "local";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) return NextResponse.json({ error: "Missing 'text'." }, { status: 400 });

    const lecture: string = String(text).trim();
    const clipped = lecture.length > 8000 ? lecture.slice(0, 8000) + "\n[...truncated for context window...]" : lecture;

    const prompt = `You are an educational podcast writer. Use ONLY the Context to write a clear, engaging solo-host script of ~900–1200 words (about 6–8 minutes).
Structure:
- Cold open (1–2 sentences hook)
- Section 1: Core idea
- Section 2: Key details/examples
- Section 3: Implications/applications
- Quick recap + 2 reflective questions
Rules:
- No external facts; only what's in Context.
- No fluff; keep it crisp, student-friendly, accurate.
- Output plain text only.

Context:
"""${clipped}"""

Podcast script:`;

    const res = await fetch(`${LLM_BASE}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        max_tokens: 1200,
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `Upstream ${res.status}: ${raw}` }, { status: 502 });
    }

    const data = await res.json();
    const script = (data?.choices?.[0]?.text || "").trim();
    return NextResponse.json({ script });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
