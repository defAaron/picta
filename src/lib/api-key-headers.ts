export const GEMINI_KEY_HEADER = "x-picta-gemini-key"
export const MAGIC_HOUR_KEY_HEADER = "x-picta-magic-hour-key"
export const MAX_API_KEY_LENGTH = 256

export function usableApiKey(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_API_KEY_LENGTH) return null
  return trimmed
}

export function canSubmitKeys(input: {
  geminiDraft: string
  magicHourDraft: string
  geminiConfigured: boolean
  requireTypedGemini: boolean
  geminiRequired?: boolean
}): boolean {
  if (usableApiKey(input.magicHourDraft) === null) return false
  if (usableApiKey(input.geminiDraft) !== null) return true
  if (input.geminiDraft.trim().length > MAX_API_KEY_LENGTH) return false
  if (input.geminiRequired === false) return true
  return input.geminiConfigured && !input.requireTypedGemini
}
