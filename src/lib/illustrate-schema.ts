export type IllustrateResult = {
  allowed: boolean
  rejectReason: string | null
  moment: string
  imagePrompt: string
}

export function parseIllustrateResult(value: unknown):
  | { ok: true; result: IllustrateResult }
  | { ok: false } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false }
  }

  const record = value as Record<string, unknown>
  const { allowed, moment, imagePrompt } = record
  const rejectReason = Object.hasOwn(record, "rejectReason") ? record.rejectReason : null
  if (typeof allowed !== "boolean") return { ok: false }
  if (!(rejectReason === null || typeof rejectReason === "string")) return { ok: false }
  if (typeof moment !== "string") return { ok: false }
  if (typeof imagePrompt !== "string") return { ok: false }

  return {
    ok: true,
    result: {
      allowed,
      rejectReason,
      moment,
      imagePrompt,
    },
  }
}
