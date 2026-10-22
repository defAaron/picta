export const CREDITS_PER_SCENE = 5

export function estimateCredits(sceneCount: number): number {
  return sceneCount * CREDITS_PER_SCENE
}

export function maxConfirmable(input: {
  isFirstConfirmation: boolean
  pagesWithoutScene: number
  sceneCreatesRemaining: number
}): number {
  const available = input.isFirstConfirmation
    ? Math.min(input.pagesWithoutScene, input.sceneCreatesRemaining)
    : input.sceneCreatesRemaining
  return Math.max(0, available)
}

export function nextBudget(budgetRemaining: number, count: number, isFirst: boolean): number {
  if (isFirst) return count
  return budgetRemaining + count
}
