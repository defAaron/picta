export type MagicHourClient = {
  create(prompt: string): Promise<{ projectId: string; creditsCharged: number }>
  get(projectId: string): Promise<
    | { status: "rendering" }
    | { status: "complete"; bytes: Uint8Array; contentType: "image/png" }
    | { status: "error" }
  >
}

type MockState = {
  prompts: string[]
  polls: Map<string, number>
  failNext: "error" | "download" | null
}

const mocks = new WeakMap<MagicHourClient, MockState>()

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120, 156,
  99, 248, 207, 192, 0, 0, 3, 1, 1, 0, 201, 254, 146, 239, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
])

function stateFor(client: MagicHourClient): MockState {
  const state = mocks.get(client)
  if (!state) {
    throw new Error("not_a_mock_client")
  }
  return state
}

export function mockPrompts(client: MagicHourClient): readonly string[] {
  return [...stateFor(client).prompts]
}

export function mockFailNext(
  client: MagicHourClient,
  failure: "error" | "download",
): void {
  stateFor(client).failNext = failure
}

export function createMockMagicHourClient(): MagicHourClient {
  const state: MockState = {
    prompts: [],
    polls: new Map(),
    failNext: null,
  }

  const client: MagicHourClient = {
    async create(prompt) {
      const projectId = crypto.randomUUID()
      state.prompts.push(prompt)
      state.polls.set(projectId, 0)
      return { projectId, creditsCharged: 5 }
    },
    async get(projectId) {
      const failure = state.failNext
      if (failure) {
        state.failNext = null
        if (failure === "download") {
          throw new Error("download_failed")
        }
        return { status: "error" }
      }

      const polls = state.polls.get(projectId)
      if (polls === undefined) {
        return { status: "error" }
      }
      if (polls === 0) {
        state.polls.set(projectId, 1)
        return { status: "rendering" }
      }
      return {
        status: "complete",
        bytes: PNG.slice(),
        contentType: "image/png",
      }
    },
  }

  mocks.set(client, state)
  return client
}

const LIVE_ORIGIN = "https://api.magichour.ai"

export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient_credits")
    this.name = "InsufficientCreditsError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error("magic_hour_request_failed")
  }
}

function downloadUrl(body: Record<string, unknown>): string {
  const downloads = body.downloads
  const first = Array.isArray(downloads) ? downloads[0] : undefined
  if (!isRecord(first) || typeof first.url !== "string" || first.url.length === 0) {
    throw new Error("download_failed")
  }
  return first.url
}

export function createLiveMagicHourClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): MagicHourClient {
  const authorization = `Bearer ${apiKey}`

  return {
    async create(prompt) {
      const response = await fetchImpl(`${LIVE_ORIGIN}/v1/ai-image-generator`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_count: 1,
          model: "z-image-turbo",
          aspect_ratio: "1:1",
          resolution: "640px",
          style: { prompt, tool: "general" },
        }),
      })

      if (response.status === 402) {
        throw new InsufficientCreditsError()
      }
      if (!response.ok) {
        throw new Error("magic_hour_create_failed")
      }

      const payload = await readJson(response)
      if (
        !isRecord(payload) ||
        typeof payload.id !== "string" ||
        typeof payload.credits_charged !== "number"
      ) {
        throw new Error("magic_hour_create_failed")
      }

      return { projectId: payload.id, creditsCharged: payload.credits_charged }
    },

    async get(projectId) {
      const response = await fetchImpl(
        `${LIVE_ORIGIN}/v1/image-projects/${encodeURIComponent(projectId)}`,
        {
          method: "GET",
          headers: { Authorization: authorization },
        },
      )
      if (!response.ok) {
        throw new Error("magic_hour_status_failed")
      }

      const payload = await readJson(response)
      if (!isRecord(payload)) {
        throw new Error("magic_hour_status_failed")
      }
      if (payload.status === "error" || payload.status === "canceled") {
        return { status: "error" }
      }
      if (payload.status !== "complete") {
        return { status: "rendering" }
      }

      const image = await fetchImpl(downloadUrl(payload))
      if (!image.ok) {
        throw new Error("download_failed")
      }

      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await image.arrayBuffer())
      } catch {
        throw new Error("download_failed")
      }
      return { status: "complete", bytes, contentType: "image/png" }
    },
  }
}
