import { openLimits, type LimitsDb } from "../../../lib/limits"
import { createMockMagicHourClient, type MagicHourClient } from "../../../lib/magic-hour"

let limitsDatabase: LimitsDb | undefined
let magicHourClient: MagicHourClient | undefined

export function getLimitsDb(): LimitsDb {
  if (limitsDatabase === undefined) {
    limitsDatabase = process.env.VITEST ? openLimits(":memory:") : openLimits()
  }
  return limitsDatabase
}

export function defaultMagicHour(): MagicHourClient {
  if (magicHourClient === undefined) {
    magicHourClient = createMockMagicHourClient()
  }
  return magicHourClient
}

export function limitsForTests(): LimitsDb {
  return getLimitsDb()
}
