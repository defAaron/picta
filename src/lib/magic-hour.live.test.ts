import { describe, expect, it } from "vitest"
import {
  createLiveMagicHourClient,
  InsufficientCreditsError,
} from "./magic-hour"
import { RejectedApiKeyError } from "./rejected-api-key"

const API_KEY = "test-key"
const LIVE_ORIGIN = `https://${["api", "magichour", "ai"].join(".")}`

type FetchCall = {
  url: string
  method: string
  headers: Headers
  body: string | undefined
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function recordedFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    }
    calls.push(call)
    return handler(call, calls.length - 1)
  }
  return { fetchImpl, calls }
}

function clientWith(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
) {
  const recorded = recordedFetch(handler)
  return {
    ...recorded,
    client: createLiveMagicHourClient(API_KEY, recorded.fetchImpl),
  }
}

describe("createLiveMagicHourClient", () => {
  it("posts the image prompt and returns the project id and credits", async () => {
    const prompt = "A red kite over a field."
    const { client, calls } = clientWith(() =>
      jsonResponse({ id: "proj-1", credits_charged: 5 }),
    )

    await expect(client.create(prompt)).resolves.toEqual({
      projectId: "proj-1",
      creditsCharged: 5,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.url).toBe(`${LIVE_ORIGIN}/v1/ai-image-generator`)
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-key")
    expect(calls[0]?.headers.get("content-type")).toBe("application/json")
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      image_count: 1,
      model: "z-image-turbo",
      aspect_ratio: "1:1",
      resolution: "640px",
      style: { prompt, tool: "general" },
    })
  })

  it("rejects a 401 without including the response body", async () => {
    const { client } = clientWith(() => new Response("secret-body", { status: 401 }))
    const error = await client.create("A red kite over a field.").then(
      () => {
        throw new Error("expected rejection")
      },
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(RejectedApiKeyError)
    expect(error).toMatchObject({ message: "rejected_api_key" })
  })

  it("throws InsufficientCreditsError on 402 and does not fetch again", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ id: "proj-1", credits_charged: 5 }, 402),
    )

    const error = await client.create("A red kite over a field.").then(
      () => {
        throw new Error("expected rejection")
      },
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(InsufficientCreditsError)
    expect(error).toMatchObject({ name: "InsufficientCreditsError" })
    expect(calls).toHaveLength(1)
  })

  it("throws a generic Error when create fails or the body is unusable", async () => {
    const cases: Array<() => Response> = [
      () => jsonResponse({ id: "proj-1", credits_charged: 5 }, 500),
      () => jsonResponse({ credits_charged: 5 }),
      () => jsonResponse({ id: 12, credits_charged: 5 }),
      () => jsonResponse({ id: "proj-1", credits_charged: "5" }),
      () => new Response("not-json", { status: 200 }),
    ]

    for (const respond of cases) {
      const { client, calls } = clientWith(() => respond())
      const error = await client.create("A red kite over a field.").then(
        () => {
          throw new Error("expected rejection")
        },
        (caught: unknown) => caught,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(InsufficientCreditsError)
      expect((error as Error).name).toBe("Error")
      expect(calls).toHaveLength(1)
    }
  })

  it.each(["queued", "rendering", "draft", "pending"])(
    "maps %s to rendering",
    async (status) => {
      const { client, calls } = clientWith(() => jsonResponse({ status }))

      await expect(client.get("proj-1")).resolves.toEqual({ status: "rendering" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.method).toBe("GET")
      expect(calls[0]?.url).toBe(`${LIVE_ORIGIN}/v1/image-projects/proj-1`)
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-key")
    },
  )

  it.each(["error", "canceled"])("maps %s to error", async (status) => {
    const { client, calls } = clientWith(() => jsonResponse({ status }))

    await expect(client.get("proj-1")).resolves.toEqual({ status: "error" })
    expect(calls).toHaveLength(1)
  })

  it("downloads a complete scene without the bearer token", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 1, 2, 3])
    const { client, calls } = clientWith((_call, index) => {
      if (index === 0) {
        return jsonResponse({
          status: "complete",
          downloads: [{ url: "https://example.test/scene.png" }],
        })
      }
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    })

    await expect(client.get("proj-1")).resolves.toEqual({
      status: "complete",
      bytes,
      contentType: "image/png",
    })

    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toBe("https://example.test/scene.png")
    expect(calls[1]?.headers.get("authorization")).toBeNull()
    for (const value of calls[1]?.headers.values() ?? []) {
      expect(value).not.toContain("test-key")
      expect(value).not.toContain("Bearer")
    }
  })

  it("throws when a complete project has no download URL", async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ status: "complete", downloads: [] }),
    )

    const error = await client.get("proj-1").then(
      () => {
        throw new Error("expected rejection")
      },
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe("Error")
    expect(calls).toHaveLength(1)
  })

  it("throws when the status response or the download is not OK", async () => {
    const failedStatus = clientWith(() => jsonResponse({ status: "complete" }, 503))
    await expect(failedStatus.client.get("proj-1")).rejects.toThrow(Error)
    expect(failedStatus.calls).toHaveLength(1)

    const failedDownload = clientWith((_call, index) => {
      if (index === 0) {
        return jsonResponse({
          status: "complete",
          downloads: [{ url: "https://example.test/scene.png" }],
        })
      }
      return new Response("nope", { status: 404 })
    })
    await expect(failedDownload.client.get("proj-1")).rejects.toThrow(Error)
    expect(failedDownload.calls).toHaveLength(2)
    expect(failedDownload.calls[1]?.headers.get("authorization")).toBeNull()
  })
})
