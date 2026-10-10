import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Mic, Square, Loader2, RotateCcw, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { recordWav } from "@/lib/record-wav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MozhiFill AI — Speak to fill your form" },
      { name: "description", content: "Speak in English, Tamil or Tanglish and watch your form fill itself with MozhiFill AI." },
      { property: "og:title", content: "MozhiFill AI — Speak to fill your form" },
      { property: "og:description", content: "Speak in English, Tamil or Tanglish and watch your form fill itself with MozhiFill AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LANGS = [
  { id: "english", label: "English", sample: "My name is Ravi Kumar, I am 28 years old, my phone is 98765 43210, I live in Chennai." },
  { id: "tamil", label: "தமிழ்", sample: "என் பெயர் ரவி குமார், எனக்கு 28 வயது, நான் சென்னையில் இருக்கிறேன்." },
  { id: "tanglish", label: "Tanglish", sample: "En peru Ravi Kumar, enakku 28 vayasu, naan Chennai la software engineer ah work panren." },
] as const;

const FIELDS: { key: string; label: string; type?: string; wide?: boolean }[] = [
  { key: "fullName", label: "Full name", wide: true },
  { key: "age", label: "Age" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email", wide: true },
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City" },
  { key: "pincode", label: "Pincode" },
  { key: "occupation", label: "Occupation", wide: true },
];

type Status = "idle" | "recording" | "processing";

function Index() {
  const [lang, setLang] = useState<string>("tanglish");
  const [status, setStatus] = useState<Status>("idle");
  const [values, setValues] = useState<Record<string, string>>({});
  const [justFilled, setJustFilled] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rec = useRef<{ stop: () => Promise<File> } | null>(null);

  async function start() {
    setError("");
    try {
      rec.current = await recordWav();
      setStatus("recording");
    } catch {
      setError("Microphone access is needed to record.");
    }
  }

  async function stop() {
    if (!rec.current) return;
    setStatus("processing");
    try {
      const file = await rec.current.stop();
      rec.current = null;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("language", lang);
      const res = await fetch("/api/voice-fill", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.transcript) setTranscript(data.transcript);
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      const filled = new Set<string>();
      setValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(data.fields as Record<string, string | null>)) {
          if (v) {
            next[k] = String(v);
            filled.add(k);
          }
        }
        return next;
      });
      setJustFilled(filled);
      if (!filled.size) setError("No form details found in what you said. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStatus("idle");
    }
  }

  const sample = LANGS.find((l) => l.id === lang)?.sample;

  return (
    <main className="min-h-screen font-sans">
      <div className="mx-auto max-w-6xl px-5 py-10 md:py-16">
        {/* Brand bar */}
        <div className="mb-8 flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold tracking-tight text-xl">MozhiFill AI</span>
            <Badge variant="secondary" className="flex items-center gap-1 text-xs">
              <Sparkles className="h-3 w-3 text-primary" /> Gemini 3.8 Flash
            </Badge>
          </div>
        </div>

        <header className="mb-10 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">MozhiFill AI</p>
          <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">
            Just speak. <span className="text-primary">We'll fill the form.</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">English, தமிழ், or Tanglish — say your details naturally.</p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
          <section className="rounded-3xl bg-hero p-7 text-primary-foreground shadow-soft lg:sticky lg:top-8 lg:self-start">
            <p className="mb-3 text-sm font-semibold opacity-90">Speaking language</p>
            <div className="mb-8 grid grid-cols-3 gap-2 rounded-2xl bg-background/15 p-1">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLang(l.id)}
                  disabled={status !== "idle"}
                  className={`rounded-xl px-2 py-2 text-sm font-semibold transition ${
                    lang === l.id ? "bg-card text-primary" : "hover:bg-background/10"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center py-4">
              <div className="relative">
                {status === "recording" && (
                  <span className="absolute inset-0 rounded-full bg-card animate-pulse-ring" />
                )}
                <button
                  onClick={status === "recording" ? stop : start}
                  disabled={status === "processing"}
                  aria-label={status === "recording" ? "Stop recording" : "Start recording"}
                  className="relative flex h-28 w-28 items-center justify-center rounded-full bg-card text-primary shadow-soft transition hover:scale-105 disabled:opacity-80"
                >
                  {status === "processing" ? (
                    <Loader2 className="h-10 w-10 animate-spin" />
                  ) : status === "recording" ? (
                    <Square className="h-9 w-9 fill-current" />
                  ) : (
                    <Mic className="h-11 w-11" />
                  )}
                </button>
              </div>
              <p className="mt-5 font-semibold">
                {status === "recording" ? "Listening… tap to finish" : status === "processing" ? "Understanding your details…" : "Tap to start speaking"}
              </p>
            </div>

            <div className="mt-6 rounded-2xl bg-background/15 p-4 text-sm">
              <p className="mb-1 font-semibold opacity-90">Try saying</p>
              <p className="italic opacity-95">“{sample}”</p>
            </div>

            {transcript && (
              <div className="mt-4 rounded-2xl bg-card p-4 text-sm text-card-foreground">
                <p className="mb-1 font-semibold text-muted-foreground">What we heard</p>
                <p>{transcript}</p>
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-xl bg-card p-3 text-sm text-destructive space-y-2">
                <p className="font-medium">{error}</p>
              </div>
            )}
          </section>

          <section className="rounded-3xl border bg-card p-7 shadow-soft">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">Personal details</h2>
              <Button variant="ghost" size="sm" onClick={() => { setValues({}); setTranscript(""); setJustFilled(new Set()); setSubmitted(false); }}>
                <RotateCcw className="mr-1 h-4 w-4" /> Clear
              </Button>
            </div>
            <form
              className="grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
            >
              {FIELDS.map((f) => {
                const hit = justFilled.has(f.key);
                return (
                  <label key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                    <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                      {f.label}
                      {hit && <Check className="h-3.5 w-3.5 text-accent" />}
                    </span>
                    <input
                      type={f.type ?? "text"}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className={`w-full rounded-xl border px-4 py-3 outline-none transition focus:ring-2 focus:ring-ring ${
                        hit ? "border-accent bg-filled" : "bg-background"
                      }`}
                    />
                  </label>
                );
              })}
              <div className="sm:col-span-2">
                <Button type="submit" size="lg" className="w-full rounded-xl">Submit form</Button>
                {submitted && <p className="mt-3 text-center text-sm font-medium text-accent">Form submitted — thank you!</p>}
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}



