import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MAX_BYTES = 20 * 1024 * 1024;

const FIELDS = [
  "fullName",
  "age",
  "gender",
  "dateOfBirth",
  "phone",
  "email",
  "address",
  "city",
  "pincode",
  "occupation",
] as const;

const LANG_HINTS: Record<string, { languages: string[]; prompt: string }> = {
  english: { languages: ["en"], prompt: "A person speaking English, giving personal details for a form." },
  tamil: { languages: ["ta"], prompt: "ஒருவர் தமிழில் தனது தனிப்பட்ட விவரங்களைக் கூறுகிறார். Transcribe in Tamil script." },
  tanglish: {
    languages: ["ta", "en"],
    prompt: "Tanglish: Tamil and English mixed speech giving personal details. Transcribe in Latin (Roman) script, e.g. 'en peru Ravi, enakku 25 vayasu'.",
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function readEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name]?.trim();
  try {
    const candidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(process.cwd(), "say-it-fill-it-main", ".env"),
      path.resolve(process.cwd(), "..", ".env"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, "utf-8");
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq !== -1) {
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key === name && val) return val;
          }
        }
      }
    }
  } catch {
    // Ignore in edge/serverless environments
  }
  return undefined;
}

function parseErrorMessage(err: unknown): string {
  if (!err) return "Unknown error occurred.";
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status || (err as any)?.httpMeta?.response?.status;

  if (status === 400 || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
    return "Invalid Gemini API key. Please check your GEMINI_API_KEY in the backend .env file.";
  }
  if (status === 403 || msg.includes("PERMISSION_DENIED")) {
    return "Permission denied for Gemini API. Please check your project settings and permissions at Google AI Studio.";
  }
  if (status === 404 || msg.includes("NOT_FOUND") || msg.includes("no longer available")) {
    return "The configured model (gemini-3.8-flash) was not found or is unavailable for this API key. Please check model access at Google AI Studio.";
  }
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
    return "Gemini API rate limit or quota exceeded. Please wait a moment and try again or check your account limits at Google AI Studio.";
  }
  if (status === 500 || status === 503 || msg.includes("UNAVAILABLE")) {
    return "Gemini API service is temporarily unavailable. Please try again shortly.";
  }
  return msg;
}

function sanitizeResult(parsed: any): { transcript: string; fields: Record<string, string | null> } {
  const transcript = typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";
  const rawFields = parsed?.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const fields: Record<string, string | null> = {};

  for (const f of FIELDS) {
    const val = rawFields[f];
    if (val !== undefined && val !== null && val !== "" && String(val).toLowerCase() !== "null") {
      fields[f] = String(val).trim();
    } else {
      fields[f] = null;
    }
  }

  return { transcript, fields };
}

async function processWithGemini(
  apiKey: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
  language: string
): Promise<{ transcript: string; fields: Record<string, string | null> }> {
  const base64Audio = Buffer.from(audioBuffer).toString("base64");
  const hint = LANG_HINTS[language] ?? LANG_HINTS["english"]!;

  const prompt = `You are MozhiFill AI, an intelligent multilingual assistant that accurately transcribes spoken audio and extracts structured personal details for form filling.
Spoken Language: ${language.toUpperCase()}
Language context: ${hint.prompt}

Tasks:
1. "transcript": Transcribe the speech accurately into the "transcript" property.
   - For English speech: transcribe in standard English.
   - For Tamil speech: transcribe in Tamil script.
   - For Tanglish speech: transcribe in Latin (Roman) script representing Tamil and English mixed words (e.g. 'en peru Ravi Kumar, enakku 28 vayasu, naan Chennai la irukken').
2. "fields": Extract the personal details into the "fields" object with these exact keys:
   - "fullName": Full name (transliterate Tamil names to English Roman script, e.g. "Ravi Kumar").
   - "age": Numeric age as a string (e.g. "28").
   - "gender": Exactly "Male", "Female", or "Other". (Convert Tamil words: aan -> Male, pen -> Female).
   - "dateOfBirth": Date in YYYY-MM-DD format if mentioned, otherwise null.
   - "phone": Digits only (convert spoken numbers in English or Tamil to numeric digits, e.g. "9876543210").
   - "email": Lowercase valid email address, converting spoken "at" to "@" and "dot" to ".".
   - "address": Street address or locality in English.
   - "city": City or town in English (e.g. "Chennai", "Coimbatore", "Madurai").
   - "pincode": 6-digit postal code if mentioned, otherwise null.
   - "occupation": Profession or occupation in English (e.g. "Software Engineer", "Doctor", "Teacher").

CRITICAL RULES:
- If a field is not explicitly mentioned in the audio, set its value to null. NEVER invent or hallucinate data.
- Return ONLY a valid JSON object matching the requested schema with keys "transcript" and "fields".`;

  const models = ["gemini-3.8-flash", "gemini-3.5-flash"];
  let lastErrorText = "";

  for (const model of models) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [
            {
              type: "audio",
              data: base64Audio,
              mime_type: mimeType || "audio/wav",
            },
            {
              type: "text",
              text: prompt,
            },
          ],
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: {
              type: "object",
              properties: {
                transcript: { type: "string" },
                fields: {
                  type: "object",
                  properties: {
                    fullName: { type: "string", nullable: true },
                    age: { type: "string", nullable: true },
                    gender: { type: "string", nullable: true },
                    dateOfBirth: { type: "string", nullable: true },
                    phone: { type: "string", nullable: true },
                    email: { type: "string", nullable: true },
                    address: { type: "string", nullable: true },
                    city: { type: "string", nullable: true },
                    pincode: { type: "string", nullable: true },
                    occupation: { type: "string", nullable: true },
                  },
                },
              },
              required: ["transcript", "fields"],
            },
          },
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        lastErrorText = `${model} returned ${res.status}: ${errorBody}`;

        // If 503 (high demand spike on 3.8-flash), gracefully try the next model
        if (res.status === 503 && model === "gemini-3.8-flash") {
          console.warn("gemini-3.8-flash 503 high demand spike; trying fallback...");
          continue;
        }

        // For fatal errors (400 bad key, 403 denied), parse and throw immediately
        throw new Error(parseErrorMessage(errorBody || lastErrorText));
      }

      const data = (await res.json()) as any;
      const modelStep = data?.steps?.find((s: any) => s.type === "model_output");
      const rawJsonText =
        modelStep?.content?.find((c: any) => c.type === "text")?.text ||
        modelStep?.content?.[0]?.text ||
        data?.output_text;

      if (!rawJsonText) {
        throw new Error("No response text returned by model.");
      }

      const parsed = JSON.parse(rawJsonText);
      return sanitizeResult(parsed);
    } catch (e: unknown) {
      if (e instanceof Error && !e.message.includes("high demand") && !lastErrorText.includes("503")) {
        throw e;
      }
    }
  }

  throw new Error(parseErrorMessage(lastErrorText || "Gemini processing failed."));
}

async function errorText(res: Response) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return j?.error?.message || j?.message || t;
  } catch {
    return t;
  }
}

export const Route = createFileRoute("/api/voice-fill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const len = Number(request.headers.get("content-length") || 0);
        if (len > MAX_BYTES) return json({ error: "Recording is too long." }, 413);

        const form = await request.formData();
        const file = form.get("file");
        const language = String(form.get("language") || "english");
        const hint = LANG_HINTS[language] ?? LANG_HINTS["english"]!;

        if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) {
          return json({ error: "Please record some audio first." }, 400);
        }

        // Securely load Gemini API key strictly on the backend
        const geminiKey = readEnvVar("GEMINI_API_KEY") || readEnvVar("VITE_GEMINI_API_KEY");

        if (geminiKey) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const result = await processWithGemini(geminiKey, arrayBuffer, file.type || "audio/wav", language);
            if (!result.transcript) {
              return json({ error: "No speech detected. Please speak clearly and try again." }, 422);
            }
            return json(result);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return json({ error: msg }, 500);
          }
        }

        // Fallback: Lovable Gateway if LOVABLE_API_KEY is configured
        const lovableKey = readEnvVar("LOVABLE_API_KEY");
        if (lovableKey) {
          const tf = new FormData();
          tf.append("model", "openai/gpt-transcribe");
          tf.append("file", file, file.name || "recording.wav");
          tf.append("response_format", "json");
          tf.append("prompt", hint.prompt);
          for (const l of hint.languages) tf.append("languages[]", l);
          const tRes = await fetch(`${GATEWAY}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableKey}` },
            body: tf,
          });
          if (!tRes.ok) return json({ error: await errorText(tRes) }, tRes.status);
          const tJson = (await tRes.json()) as { text?: string };
          const transcript = (tJson.text || "").trim();
          if (!transcript) return json({ error: "No speech detected. Please try again." }, 422);

          const properties = Object.fromEntries(FIELDS.map((f) => [f, { type: ["string", "null"] }]));
          const eRes = await fetch(`${GATEWAY}/responses`, {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-6-astra",
              reasoning: { effort: "low" },
              instructions:
                "You extract personal form details from a spoken transcript in English, Tamil, or Tanglish. " +
                "Understand Tamil words (e.g. peru/பெயர்=name, vayasu/வயது=age, oor/ஊர்=city, velai/வேலை=occupation, aan/ஆண்=Male, pen/பெண்=Female, mobile number, mugavari/முகவரி=address). " +
                "Return values in English / Roman script. Names: transliterate to English letters. Phone: digits only. " +
                "Age: number as string. dateOfBirth: YYYY-MM-DD. gender: Male, Female or Other. email: lowercase. Use null when a detail is not mentioned. Never invent data.",
              input: transcript,
              text: {
                format: {
                  type: "json_schema",
                  name: "form_details",
                  strict: true,
                  schema: { type: "object", properties, required: [...FIELDS], additionalProperties: false },
                },
              },
            }),
          });
          if (!eRes.ok) return json({ error: await errorText(eRes), transcript }, eRes.status);
          const eJson = (await eRes.json()) as {
            output_text?: string;
            output?: { type: string; content?: { type: string; text?: string }[] }[];
          };
          const text =
            eJson.output_text ??
            eJson.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text ??
            "";
          let fields: Record<string, string | null> = {};
          try {
            fields = JSON.parse(text);
          } catch {
            return json({ error: "Could not understand the details. Please try again.", transcript }, 422);
          }
          return json({ transcript, fields });
        }

        return json(
          {
            error:
              "Gemini API is not configured on the server. Please set GEMINI_API_KEY in your backend .env file.",
          },
          500
        );
      },
    },
  },
});


