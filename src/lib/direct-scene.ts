export const MAX_DIRECT_PROMPT = 1500

const TOO_LONG = "Without a Gemini key, keep the description to 1,500 characters."
const CANNOT_ILLUSTRATE = "That page could not be illustrated."

export function directScenePrompt(pageText: string):
  | { ok: true; prompt: string; moment: string }
  | { ok: false; reason: string } {
  const prompt = pageText.trim().replace(/\s+/g, " ")
  if (prompt.length < 1) return { ok: false, reason: CANNOT_ILLUSTRATE }
  if (prompt.length > MAX_DIRECT_PROMPT) return { ok: false, reason: TOO_LONG }
  return { ok: true, prompt, moment: prompt.slice(0, 200) }
}
