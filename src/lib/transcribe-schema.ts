export type TranscribeResult = {
  accepted: boolean
  rejectReason: string | null
  singlePage: boolean
  text: string
}

export function parseTranscribeResult(value: unknown):
  | { ok: true; result: TranscribeResult }
  | { ok: false } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false }
  }

  const record = value as Record<string, unknown>
  const { accepted, singlePage, text, rejectReason } = record
  if (typeof accepted !== "boolean") return { ok: false }
  if (typeof singlePage !== "boolean") return { ok: false }
  if (typeof text !== "string") return { ok: false }
  if (!(rejectReason === null || typeof rejectReason === "string")) return { ok: false }

  return {
    ok: true,
    result: {
      accepted,
      rejectReason,
      singlePage,
      text,
    },
  }
}
