import { describe, expect, it } from "vitest"
import {
  createMockMagicHourClient,
  mockFailNext,
  mockPrompts,
} from "./magic-hour"

describe("createMockMagicHourClient", () => {
  it("records the prompt and charges 5 credits", async () => {
    const client = createMockMagicHourClient()
    const created = await client.create("A red kite over a field.")

    expect(created.creditsCharged).toBe(5)
    expect(created.projectId.length).toBeGreaterThan(0)
    expect(mockPrompts(client)).toEqual(["A red kite over a field."])
    expect(mockPrompts(createMockMagicHourClient())).toEqual([])
  })

  it("returns rendering, then a PNG", async () => {
    const client = createMockMagicHourClient()
    const { projectId } = await client.create("A red kite over a field.")

    await expect(client.get(projectId)).resolves.toEqual({ status: "rendering" })

    const done = await client.get(projectId)
    expect(done.status).toBe("complete")
    if (done.status !== "complete") {
      return
    }
    expect(done.contentType).toBe("image/png")
    expect(Array.from(done.bytes.slice(0, 4))).toEqual([137, 80, 78, 71])
  })

  it("returns an error for an unknown project", async () => {
    const client = createMockMagicHourClient()
    await expect(client.get("missing")).resolves.toEqual({ status: "error" })
  })

  it("returns an error when the next get is forced to fail", async () => {
    const client = createMockMagicHourClient()
    const { projectId } = await client.create("A red kite over a field.")
    mockFailNext(client, "error")

    await expect(client.get(projectId)).resolves.toEqual({ status: "error" })
    await expect(client.get(projectId)).resolves.toEqual({ status: "rendering" })
  })

  it("throws when the next get is forced to fail the download", async () => {
    const client = createMockMagicHourClient()
    const { projectId } = await client.create("A red kite over a field.")
    mockFailNext(client, "download")

    await expect(client.get(projectId)).rejects.toThrow(
      new Error("download_failed"),
    )
    await expect(client.get(projectId)).resolves.toEqual({ status: "rendering" })
  })

  it("stores the scene prompt and not the page text", async () => {
    const client = createMockMagicHourClient()
    await client.create("A lantern in a stairwell.")

    expect(mockPrompts(client)).toEqual(["A lantern in a stairwell."])
    expect(mockPrompts(client)).not.toContain("SECRET_PAGE_TEXT")
  })
})
