import { openLimits, type LimitsDb } from "../../../lib/limits"
import {
  createLiveMagicHourClient,
  createMockMagicHourClient,
  type MagicHourClient,
} from "../../../lib/magic-hour"

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

export function resolveMagicHour(injected?: MagicHourClient): {
  client: MagicHourClient
  simulated: boolean
} {
  if (injected !== undefined) {
    return { client: injected, simulated: true }
  }
  const apiKey = process.env.MAGIC_HOUR_API_KEY
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { client: createLiveMagicHourClient(apiKey), simulated: false }
  }
  return { client: defaultMagicHour(), simulated: true }
}

export function limitsForTests(): LimitsDb {
  return getLimitsDb()
}
