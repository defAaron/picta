import { describe, expect, it } from "vitest"
import { estimateCredits, maxConfirmable, nextBudget } from "./budget"

describe("budget", () => {
  it("estimates 5 credits per scene", () => {
    expect(estimateCredits(3)).toBe(15)
  })

  it("caps the first confirmation by pages that have no scene", () => {
    expect(maxConfirmable({
      isFirstConfirmation: true,
      pagesWithoutScene: 2,
      sceneCreatesRemaining: 8,
    })).toBe(2)
  })

  it("lets a later confirmation use the server remainder", () => {
    expect(maxConfirmable({
      isFirstConfirmation: false,
      pagesWithoutScene: 0,
      sceneCreatesRemaining: 4,
    })).toBe(4)
  })

  it("sets the budget on the first confirmation and adds after that", () => {
    expect(nextBudget(0, 2, true)).toBe(2)
    expect(nextBudget(1, 2, false)).toBe(3)
  })
})
