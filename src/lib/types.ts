export type Reading = {
  id: string
  createdAt: number
  hasConfirmedBudget: boolean
  budgetRemaining: number
  restoredProjectIds: string[]
  pages: Page[]
}

export type Page = {
  id: string
  text: string
  photo: Blob | null
  scene: Scene | null
}

export type Scene = {
  projectId: string
  moment: string
  imagePrompt: string
  creditsCharged: number
  status: "rendering" | "complete" | "download_failed"
  image: Blob | null
  simulated?: boolean
}
