import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { text, voice, speed = 1.0 } = await req.json();
    if (!text || !voice) {
      return NextResponse.json({ error: "Missing 'text' or 'voice'." }, { status: 400 });
    }
    const provider = (process.env.TTS_PROVIDER || "").toLowerCase();

    if (provider === "elevenlabs") {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "Missing ELEVENLABS_API_KEY" }, { status: 500 });

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?optimize_streaming_latency=0`;
      const body = {
        model_id: "eleven_multilingual_v2",
        text,
        voice_settings: { stability: 0.4, similarity_boost: 0.7, style: 0.3, use_speaker_boost: true }
      };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const raw = await res.text();
        return new NextResponse(`TTS upstream ${res.status}: ${raw}`, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return new NextResponse(buf, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }

    if (provider === "azure") {
      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;
      if (!key || !region) return NextResponse.json({ error: "Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION" }, { status: 500 });

      const ssml = `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${Math.round(speed*100)}%">${escapeXml(text)}</prosody>
  </voice>
</speak>`;
      const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
        },
        body: ssml
      });
      if (!res.ok) {
        const raw = await res.text();
        return new NextResponse(`TTS upstream ${res.status}: ${raw}`, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return new NextResponse(buf, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }

    // No provider configured: client can fall back to browser TTS
    return NextResponse.json({ error: "No TTS provider configured (set TTS_PROVIDER). Browser fallback available." }, { status: 501 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;" }[c] as string));
}
