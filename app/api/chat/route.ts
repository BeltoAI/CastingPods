import { NextResponse } from "next/server";

const LLM_BASE = process.env.LLM_BASE || "http://minibelto.duckdns.org:8007";
const LLM_MODEL = process.env.LLM_MODEL || "local";

export async function POST(req: Request) {
  try {
    const { text, history = [], question } = await req.json();

    if (!text || !question) {
      return NextResponse.json({ error: "Missing 'text' or 'question'." }, { status: 400 });
    }

    const lecture: string = String(text).trim();
    const clipped = lecture.length > 8000 ? lecture.slice(0, 8000) + "\n[...truncated for context window...]" : lecture;
    const convo = Array.isArray(history)
      ? history.map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")
      : "";

    const prompt = `You are CASTINGPODS, a precise study aide.
Answer ONLY using the Context below. If the answer is not directly supported by the Context, reply exactly:
"I can't find that in the provided text."
Do NOT use outside knowledge. Keep answers concise unless asked for detail.

# Context
"""${clipped}"""

# Conversation (may be empty)
${convo}

# Question
${question}

# Answer`;

    const res = await fetch(`${LLM_BASE}/v1/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        max_tokens: 400,
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `Upstream ${res.status}: ${raw}` }, { status: 502 });
    }

    const data = await res.json();
    const answer = (data?.choices?.[0]?.text || "").trim();
    return NextResponse.json({ answer });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
