import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { clearReading, loadReading, saveReading } from "./reading-store"
import type { Reading } from "./types"

describe("reading store", () => {
  it("round-trips one reading and then clears it", async () => {
    const reading: Reading = {
      id: "reading-1",
      createdAt: 1_700_000_000_000,
      hasConfirmedBudget: true,
      budgetRemaining: 2,
      restoredProjectIds: [],
      pages: [
        {
          id: "page-1",
          text: "A quiet room.",
          photo: null,
          scene: null,
        },
      ],
    }

    await saveReading(reading)

    const loaded = await loadReading()
    expect(loaded).toEqual(reading)
    expect(loaded?.pages[0]?.photo).toBeNull()
    expect(loaded?.pages[0]?.scene).toBeNull()

    await clearReading()
    await expect(loadReading()).resolves.toBeNull()
  })
})
