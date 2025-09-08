"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Headphones, MessageSquare, Sparkles, Upload, Wand2, Volume2, Pause, Square, Users } from "lucide-react";
import clsx from "clsx";

type Msg = { role: "user" | "assistant"; content: string };
type PanelUtterance = { speaker: "Guide" | "Skeptic" | "Synthesizer"; text: string };

export default function Page() {
  const [text, setText] = useState<string>("");
  const [tab, setTab] = useState<"chat" | "podcast" | "panel">("chat");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Paste your lecture on the left. Ask a question; I will answer using only that text." }
  ]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  // Podcast state
  const [script, setScript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const queueRef = useRef<SpeechSynthesisUtterance[]>([]);
  const pausedRef = useRef(false);

  // Panel state
  const [panelPrompt, setPanelPrompt] = useState("Explain the key idea like a roundtable.");
  const [dialogue, setDialogue] = useState<PanelUtterance[] | null>(null);
  const [panelPlaying, setPanelPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [level, setLevel] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<PanelUtterance["speaker"] | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("castingpods:text");
    if (saved) setText(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("castingpods:text", text);
    setWarn(text.length > 8000 ? "Long text detected: using an excerpt to stay in context window." : null);
  }, [text]);

  async function ask() {
    if (!text.trim()) { alert("Paste the lecture text first."); return; }
    if (!q.trim()) return;
    setLoading(true);
    const history = messages.slice(-8);
    setMessages(m => [...m, { role: "user", content: q }]);
    setQ("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history, question: history.length ? q : `Explain: ${q}` })
      });
      const data = await res.json();
      if (data?.answer) setMessages(m => [...m, { role: "assistant", content: data.answer }]);
      else setMessages(m => [...m, { role: "assistant", content: "Upstream error. Try again." }]);
    } catch (e:any) {
      setMessages(m => [...m, { role: "assistant", content: "Request failed: " + (e?.message || e) }]);
    } finally { setLoading(false); }
  }

  async function genPodcast() {
    if (!text.trim()) { alert("Paste the lecture text first."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/podcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      setScript((data?.script || "Upstream error.").trim());
    } catch (e:any) {
      setScript("Request failed: " + (e?.message || e));
    } finally { setLoading(false); }
  }

  function speakStart() {
    // Browser fallback TTS for the single-host podcast
    if (!("speechSynthesis" in window)) { alert("No speechSynthesis support."); return; }
    if (!script.trim()) { alert("Generate the podcast script first."); return; }
    if (speaking) return;
    synthRef.current = window.speechSynthesis;
    queueRef.current = [];
    pausedRef.current = false;

    const chunks = splitForTTS(script, 220);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      const voices = window.speechSynthesis.getVoices();
      const cand = voices.find(v => /en[-_](US|GB)/i.test(v.lang)) || voices[0];
      if (cand) u.voice = cand;
      u.rate = 1.02; u.pitch = 1.0;
      u.onend = () => { if (i === chunks.length - 1) setSpeaking(false); };
      queueRef.current.push(u);
    });
    setSpeaking(true);
    queueRef.current.forEach(u => synthRef.current!.speak(u));
  }
  function speakPause() {
    if (!speaking || !synthRef.current) return;
    if (!pausedRef.current) { synthRef.current.pause(); pausedRef.current = true; setSpeaking(false); }
    else { synthRef.current.resume(); pausedRef.current = false; setSpeaking(true); }
  }
  function speakStop() { if (synthRef.current) synthRef.current.cancel(); setSpeaking(false); pausedRef.current = false; }

  async function runPanel() {
    if (!text.trim()) { alert("Paste the lecture text first."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, prompt: panelPrompt })
      });
      const data = await res.json();
      if (data?.dialogue) {
        setDialogue(data.dialogue);
        await playDialogue(data.dialogue);
      } else {
        alert(data?.error || "Error generating dialogue");
      }
    } catch (e:any) {
      alert("Panel failed: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function ttsToUrl(speaker: PanelUtterance["speaker"], text: string): Promise<string | null> {
    // Determine voice name by env-provided mapping (read at build time)
    const env = {
      provider: process.env.NEXT_PUBLIC_TTS_PROVIDER || "",
      guide: process.env.NEXT_PUBLIC_ELEVEN_GUIDE || "",
      skeptic: process.env.NEXT_PUBLIC_ELEVEN_SKEPTIC || "",
      synth: process.env.NEXT_PUBLIC_ELEVEN_SYNTH || ""
    };
    const voice = speaker === "Guide"
      ? (process.env.NEXT_PUBLIC_TTS_GUIDE || process.env.NEXT_PUBLIC_ELEVEN_GUIDE || "Rachel")
      : speaker === "Skeptic"
        ? (process.env.NEXT_PUBLIC_TTS_SKEPTIC || process.env.NEXT_PUBLIC_ELEVEN_SKEPTIC || "Adam")
        : (process.env.NEXT_PUBLIC_TTS_SYNTH || process.env.NEXT_PUBLIC_ELEVEN_SYNTH || "Bella");

    // Ask backend to synthesize; if no provider configured, it returns 501 (client can fallback)
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
    if (r.status === 501) return null; // fallback to browser TTS later
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }

  async function playDialogue(dlg: PanelUtterance[]) {
    // Stop previous
    stopPanel();

    // Try neural TTS first. If unavailable, fall back to browser TTS.
    const urls: (string | null)[] = [];
    for (const u of dlg) {
      try { urls.push(await ttsToUrl(u.speaker, u.text)); }
      catch { urls.push(null); }
    }

    const anyNeural = urls.some(Boolean);
    if (!anyNeural && "speechSynthesis" in window) {
      // Browser fallback: sequential speechSynthesis utterances
      const voices = window.speechSynthesis.getVoices();
      const vGuide = voices.find(v=>/Jenny|Aria|en-GB|en-US/i.test(v.name)) || voices[0];
      const vSkep  = voices.find(v=>/Guy|Ryan|en-US/i.test(v.name)) || voices[0];
      const vSynth = voices.find(v=>/Aria|Sonia|en-GB|en-US/i.test(v.name)) || voices[0];

      setPanelPlaying(true);
      for (const [i, u] of dlg.entries()) {
        setActiveSpeaker(u.speaker);
        await speakOnce(u.text, u.speaker === "Guide" ? vGuide : u.speaker === "Skeptic" ? vSkep : vSynth);
      }
      setPanelPlaying(false); setActiveSpeaker(null);
      return;
    }

    // Neural path: use <audio> + WebAudio analyser for glow/scale
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = audioCtxRef.current.createMediaElementSource(audioRef.current);
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    src.connect(analyserRef.current);
    analyserRef.current.connect(audioCtxRef.current.destination);

    setPanelPlaying(true);
    for (let i = 0; i < dlg.length; i++) {
      const u = dlg[i];
      setActiveSpeaker(u.speaker);
      const url = urls[i]!;
      if (!url) continue;
      audioRef.current.src = url;
      await audioRef.current.play();
      // Poll volume while playing
      await new Promise<void>((resolve) => {
        const buf = new Uint8Array(analyserRef.current!.frequencyBinCount);
        const tick = () => {
          if (!audioRef.current || audioRef.current.paused || audioRef.current.ended) { setLevel(0); resolve(); return; }
          analyserRef.current!.getByteFrequencyData(buf);
          const avg = buf.reduce((a,b)=>a+b,0) / buf.length;
          setLevel(avg / 255);
          requestAnimationFrame(tick);
        };
        audioRef.current!.onended = () => { setLevel(0); resolve(); };
        tick();
      });
      URL.revokeObjectURL(url);
    }
    setPanelPlaying(false); setActiveSpeaker(null);
  }

  function stopPanel() {
    setPanelPlaying(false);
    setActiveSpeaker(null);
    setLevel(0);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    if (synthRef.current) synthRef.current.cancel();
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="size-6 text-cyan-300" />
            <div className="text-xl font-semibold gradient-text">CastingPods</div>
          </div>
          <div className="text-xs text-white/70">Paste → Chat → Podcast → Panel. Answers strictly from your text.</div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Paste area */}
          <motion.div className="glass p-4 md:p-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="flex items-center gap-2 mb-3">
              <Upload className="size-5 text-cyan-300" />
              <h2 className="text-lg">Lecture Text</h2>
            </div>
            <textarea
              className="w-full h-72 md:h-[540px] p-4 rounded-xl bg-white/5 outline-none border border-white/10 focus:border-cyan-300/40 placeholder-white/40"
              placeholder="Paste your lecture/article/notes here…"
              value={text}
              onChange={e => setText(e.target.value)}
            />
            {warn && <div className="mt-2 text-xs text-amber-300/80">{warn}</div>}
          </motion.div>

          {/* Right: Tabs + Panels */}
          <motion.div className="glass p-4 md:p-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
            <div className="flex gap-2 mb-4">
              <TabButton label="Chat" icon={<MessageSquare className="size-4" />} active={tab === "chat"} onClick={()=>setTab("chat")} color="cyan" />
              <TabButton label="Podcast" icon={<Headphones className="size-4" />} active={tab === "podcast"} onClick={()=>setTab("podcast")} color="violet" />
              <TabButton label="Panel" icon={<Users className="size-4" />} active={tab === "panel"} onClick={()=>setTab("panel")} color="emerald" />
              {loading && <div className="ml-auto text-xs text-white/70 animate-pulse">Working…</div>}
            </div>

            {tab === "chat" && (
              <div className="flex flex-col h-[560px]">
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {messages.map((m, i) => (
                    <div key={i} className={clsx("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-white/10" : "mr-auto bg-white/5 border border-white/10")}>
                      <div className="flex items-start gap-2">
                        {m.role === "assistant" ? <Bot className="size-4 mt-0.5 text-cyan-300" /> : <MessageSquare className="size-4 mt-0.5 text-emerald-300" />}
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none focus:border-cyan-300/40"
                    placeholder="Ask about the pasted text…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }} />
                  <button onClick={ask} className="px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-300/30 hover:bg-cyan-500/30 transition">Ask</button>
                </div>
                <div className="mt-2 text-[11px] text-white/60">Guardrails: only from your text. Missing facts → explicit denial.</div>
              </div>
            )}

            {tab === "podcast" && (
              <div className="space-y-3">
                <div className="text-sm text-white/80">Generate a 6–8 minute script strictly from your text, then play it.</div>
                <div className="flex gap-2">
                  <button onClick={genPodcast} className="px-3 py-2 rounded-lg bg-violet-500/20 border border-violet-300/30 hover:bg-violet-500/30 transition">
                    <div className="flex items-center gap-2"><Wand2 className="size-4" /> Generate Script</div>
                  </button>
                  <button onClick={speakStart} className="px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-300/30 hover:bg-emerald-500/30 transition">
                    <div className="flex items-center gap-2"><Volume2 className="size-4" /> Play (Browser)</div>
                  </button>
                  <button onClick={speakPause} className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-300/30 hover:bg-amber-500/30 transition"><Pause className="size-4" /></button>
                  <button onClick={speakStop} className="px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-300/30 hover:bg-rose-500/30 transition"><Square className="size-4" /></button>
                </div>
                <textarea className="w-full h-80 p-3 rounded-xl bg-white/5 outline-none border border-white/10 focus:border-violet-300/40 placeholder-white/40"
                  placeholder="Podcast script will appear here…" value={script} onChange={e => setScript(e.target.value)} />
                <div className="text-[11px] text-white/60">Tip: add your TTS keys to use neural voices instead of browser speech.</div>
              </div>
            )}

            {tab === "panel" && (
              <div className="space-y-3">
                <div className="text-sm text-white/80">Roundtable: three avatars discuss your topic using only your text.</div>
                <div className="flex gap-2">
                  <input className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none focus:border-emerald-300/40"
                    placeholder="Prompt, e.g., 'Compare the two theories and their implications.'" value={panelPrompt} onChange={e => setPanelPrompt(e.target.value)} />
                  <button onClick={runPanel} className="px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-300/30 hover:bg-emerald-500/30 transition">Generate & Speak</button>
                  <button onClick={stopPanel} className="px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-300/30 hover:bg-rose-500/30 transition">Stop</button>
                </div>

                {/* Avatars */}
                <div className="grid grid-cols-3 gap-3 mt-2">
                  {(["Guide","Skeptic","Synthesizer"] as const).map((name) => (
                    <Avatar key={name} name={name} active={activeSpeaker === name} level={level} />
                  ))}
                </div>

                {/* Transcript */}
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                  {dialogue?.map((u, idx) => (
                    <div key={idx} className="text-sm">
                      <span className="text-white/70">{u.speaker}:</span> <span className="text-white/90">{u.text}</span>
                    </div>
                  )) || <div className="text-sm text-white/60">No dialogue yet. Enter a prompt above.</div>}
                </div>
                <div className="text-[11px] text-white/60">No celebrity cloning. Use licensed voices via ElevenLabs/Azure.</div>
              </div>
            )}
          </motion.div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-white/50">
          CastingPods — built for students. Your data stays in your browser; the model only sees your pasted text through the API.
        </div>
      </div>
    </div>
  );
}

function TabButton({ label, icon, active, onClick, color }:{label:string; icon:React.ReactNode; active:boolean; onClick:()=>void; color:"cyan"|"violet"|"emerald"}) {
  const cls = active ? `bg-${color}-500/20 border-${color}-300/30` : "border-white/10";
  return (
    <button className={clsx("px-3 py-2 rounded-lg text-sm border", cls)} onClick={onClick}>
      <div className="flex items-center gap-2">{icon} {label}</div>
    </button>
  );
}

function Avatar({ name, active, level }:{ name: "Guide"|"Skeptic"|"Synthesizer"; active:boolean; level:number }) {
  const glow = active ? `shadow-[0_0_40px_rgba(34,197,94,0.5)]` : "shadow-none";
  const scale = active ? 1 + level * 0.15 : 1;
  const palette = name === "Guide" ? "from-cyan-400 to-emerald-400"
                : name === "Skeptic" ? "from-rose-400 to-amber-400"
                : "from-violet-400 to-cyan-400";
  return (
    <div className="glass p-3 text-center">
      <motion.div
        className={clsx("mx-auto w-20 h-20 rounded-full bg-gradient-to-br", palette, glow)}
        animate={{ scale }}
        transition={{ type: "spring", stiffness: 120, damping: 12 }}
      />
      <div className="mt-2 text-xs text-white/80">{name}</div>
    </div>
  );
}

function splitForTTS(s: string, maxLen = 220) {
  const parts: string[] = []; let buf = ""; const push=()=>{ if (buf.trim()) { parts.push(buf.trim()); buf=""; } };
  for (const seg of s.split(/(\.|\?|!|\n)/)) { if ((buf + seg).length > maxLen) push(); buf += seg; }
  push(); return parts;
}

async function speakOnce(text: string, voice?: SpeechSynthesisVoice) {
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.03; u.pitch = 1.0;
    u.onend = () => resolve();
    window.speechSynthesis.speak(u);
  });
}
