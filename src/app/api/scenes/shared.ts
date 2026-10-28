import { openLimits, type LimitsDb } from "../../../lib/limits"
import { createLiveMagicHourClient, type MagicHourClient } from "../../../lib/magic-hour"

let limitsDatabase: LimitsDb | undefined

export function getLimitsDb(): LimitsDb {
  if (limitsDatabase === undefined) {
    limitsDatabase = process.env.VITEST ? openLimits(":memory:") : openLimits()
  }
  return limitsDatabase
}

export function resolveMagicHour(
  injected?: MagicHourClient,
  apiKey?: string,
): { client: MagicHourClient; simulated: boolean } | null {
  if (injected !== undefined) {
    return { client: injected, simulated: true }
  }
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { client: createLiveMagicHourClient(apiKey), simulated: false }
  }
  return null
}

export function limitsForTests(): LimitsDb {
  return getLimitsDb()
}
