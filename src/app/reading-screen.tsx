"use client"

import { useEffect, useRef, useState } from "react"
import { estimateCredits, maxConfirmable, nextBudget } from "@/lib/budget"
import { joinPages, splitPageAt, splitPaste } from "@/lib/pages"
import { clearReading, loadReading, saveReading } from "@/lib/reading-store"
import type { Page, Reading, Scene } from "@/lib/types"
import { OnPageView } from "./on-page-view"

type Caret = {
  start: number
  end: number
}

type Phase = "loading" | "error" | "ready"

type QuotaStatus =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; sceneCreatesRemaining: number; sceneWindowResetsAt: number }

function pasteFailure(reason: "empty" | "too_long" | "too_many_pages"): string {
  if (reason === "empty") return "That excerpt is empty."
  if (reason === "too_long") return "That excerpt is too long."
  return "That excerpt has too many pages."
}

function parseSceneCount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  const count = Number(trimmed)
  if (!Number.isInteger(count) || !Number.isFinite(count)) return null
  return count
}

function blankPage(text: string): Page {
  return {
    id: crypto.randomUUID(),
    text,
    photo: null,
    scene: null,
  }
}

function isPhotoPayload(
  value: unknown,
): value is { accepted: true; text: string } | { accepted: false; reason: string } {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (record.accepted === true && typeof record.text === "string") return true
  return record.accepted === false && typeof record.reason === "string"
}

function isQuotaPayload(value: unknown): value is {
  sceneCreatesRemaining: number
  sceneWindowResetsAt: number
} {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sceneCreatesRemaining === "number" &&
    Number.isFinite(record.sceneCreatesRemaining) &&
    typeof record.sceneWindowResetsAt === "number" &&
    Number.isFinite(record.sceneWindowResetsAt)
  )
}

const SCENE_POLL_MS = 2000
const SCENE_POLL_LIMIT_MS = 3 * 60 * 1000

type AttemptKey = {
  key: string
  replacingProjectId: string | null
}

type PollHandle = {
  interval: ReturnType<typeof setInterval>
  timeout: ReturnType<typeof setTimeout>
}

type AllowedScene = {
  allowed: true
  projectId: string
  moment: string
  imagePrompt: string
  creditsCharged: number
  simulated?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isAllowedScene(value: unknown): value is AllowedScene {
  if (!isRecord(value) || value.allowed !== true) return false
  return (
    typeof value.projectId === "string" &&
    value.projectId.length > 0 &&
    typeof value.moment === "string" &&
    typeof value.imagePrompt === "string" &&
    typeof value.creditsCharged === "number" &&
    Number.isFinite(value.creditsCharged)
  )
}

function isRejectedScene(value: unknown): value is { allowed: false; reason: string } {
  return isRecord(value) && value.allowed === false && typeof value.reason === "string"
}

function SceneImage({ image, simulated }: { image: Blob; simulated: boolean }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(image)
    setSrc(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [image])

  return (
    <figure className="scene-frame">
      {src ? <img src={src} alt={simulated ? "Simulated scene" : "Scene"} /> : null}
      {simulated ? <figcaption>Simulated scene</figcaption> : null}
    </figure>
  )
}

export default function ReadingScreen() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [reading, setReading] = useState<Reading | null>(null)
  const [paste, setPaste] = useState("")
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [photoMessage, setPhotoMessage] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [sceneCount, setSceneCount] = useState("")
  const [carets, setCarets] = useState<Record<string, Caret>>({})
  const [quota, setQuota] = useState<QuotaStatus>({ status: "loading" })
  const [quotaOpen, setQuotaOpen] = useState(false)

  const readingRef = useRef<Reading | null>(null)
  const canSaveRef = useRef(false)
  const saveChainRef = useRef(Promise.resolve())
  const budgetCountRef = useRef<HTMLInputElement>(null)
  const attemptKeys = useRef<Record<string, AttemptKey>>({})
  const pollTimers = useRef<Record<string, PollHandle>>({})
  const pollBusy = useRef<Record<string, boolean>>({})
  const checkLocks = useRef<Record<string, boolean>>({})
  const postingRef = useRef(false)
  const readingEpoch = useRef(0)
  const pollingApi = useRef<{
    start: (pageId: string, projectId: string) => void
    stopAll: () => void
  }>({
    start: () => undefined,
    stopAll: () => undefined,
  })

  const [pageNotes, setPageNotes] = useState<Record<string, string>>({})
  const [awaitingCheck, setAwaitingCheck] = useState<Record<string, boolean>>({})
  const [illustrateBusy, setIllustrateBusy] = useState(false)
  const [onPageId, setOnPageId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadReading()
      .then((stored) => {
        if (cancelled) return
        readingRef.current = stored
        canSaveRef.current = true
        setReading(stored)
        setPhase("ready")
      })
      .catch(() => {
        if (cancelled) return
        setPhase("error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const budgetOpen = reading !== null && reading.pages.length > 0
  if (budgetOpen !== quotaOpen) {
    setQuotaOpen(budgetOpen)
    setQuota({ status: "loading" })
  }

  useEffect(() => {
    if (!budgetOpen) return
    let cancelled = false
    async function loadQuota() {
      try {
        const sessionResponse = await fetch("/api/session", {
          method: "POST",
          credentials: "same-origin",
        })
        if (!sessionResponse.ok) throw new Error("session")
        const quotaResponse = await fetch("/api/quota", {
          credentials: "same-origin",
        })
        if (!quotaResponse.ok) throw new Error("quota")
        const body: unknown = await quotaResponse.json()
        if (cancelled) return
        if (!isQuotaPayload(body)) {
          setQuota({ status: "error" })
          return
        }
        setQuota({
          status: "ready",
          sceneCreatesRemaining: body.sceneCreatesRemaining,
          sceneWindowResetsAt: body.sceneWindowResetsAt,
        })
      } catch {
        if (!cancelled) setQuota({ status: "error" })
      }
    }
    void loadQuota()
    return () => {
      cancelled = true
    }
  }, [budgetOpen])

  useEffect(() => {
    if (phase !== "ready") return
    const stored = readingRef.current
    if (stored) {
      for (const page of stored.pages) {
        if (page.scene?.status === "rendering") {
          pollingApi.current.start(page.id, page.scene.projectId)
        }
      }
    }
    return () => {
      pollingApi.current.stopAll()
    }
  }, [phase])

  function persist(next: Reading): boolean {
    if (!canSaveRef.current) return false
    readingRef.current = next
    setReading(next)
    const snapshot = next
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!canSaveRef.current) return
        await saveReading(snapshot)
      })
      .catch(() => undefined)
    return true
  }

  function rememberCaret(pageId: string, element: HTMLTextAreaElement) {
    const start = element.selectionStart
    const end = element.selectionEnd
    if (start === null || end === null) return
    setCarets((current) => {
      const previous = current[pageId]
      if (previous?.start === start && previous.end === end) return current
      return { ...current, [pageId]: { start, end } }
    })
  }

  function choosePhoto(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    setPhotoMessage(null)
    if (!canSaveRef.current) return
    if ((readingRef.current?.pages.length ?? 0) >= 8) {
      setPhotoMessage("This reading already has 8 pages.")
      return
    }
    void sendPhoto(file)
  }

  async function sendPhoto(file: File) {
    setPhotoBusy(true)
    try {
      const body = new FormData()
      body.append("image", file)
      let response: Response
      try {
        response = await fetch("/api/transcribe", {
          method: "POST",
          credentials: "same-origin",
          body,
        })
      } catch {
        setPhotoMessage("Transcription is unavailable.")
        return
      }
      if (response.status === 400) {
        setPhotoMessage("Choose a JPEG, PNG, or WebP photo under 8 MB.")
        return
      }
      if (response.status === 429) {
        setPhotoMessage("The transcription limit is full.")
        return
      }
      if (!response.ok) {
        setPhotoMessage("Transcription is unavailable.")
        return
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        setPhotoMessage("Transcription is unavailable.")
        return
      }
      if (!isPhotoPayload(payload)) {
        setPhotoMessage("Transcription is unavailable.")
        return
      }
      if (!payload.accepted) {
        setPhotoMessage(payload.reason)
        return
      }
      if (!canSaveRef.current) return
      const current = readingRef.current
      if ((current?.pages.length ?? 0) >= 8) {
        setPhotoMessage("This reading already has 8 pages.")
        return
      }
      const page: Page = {
        id: crypto.randomUUID(),
        text: payload.text,
        photo: file,
        scene: null,
      }
      const next: Reading = current
        ? { ...current, pages: [...current.pages, page] }
        : {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            hasConfirmedBudget: false,
            budgetRemaining: 0,
            restoredProjectIds: [],
            pages: [page],
          }
      persist(next)
    } finally {
      setPhotoBusy(false)
    }
  }

  function addPages() {
    if (!canSaveRef.current) return
    const result = splitPaste(paste)
    if (!result.ok) {
      setPasteError(pasteFailure(result.reason))
      return
    }
    const current = readingRef.current
    const currentCount = current?.pages.length ?? 0
    if (currentCount + result.pages.length > 8) {
      setPasteError("That excerpt is too long.")
      return
    }
    const added = result.pages.map((text) => blankPage(text))
    const next: Reading = current
      ? { ...current, pages: [...current.pages, ...added] }
      : {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          hasConfirmedBudget: false,
          budgetRemaining: 0,
          restoredProjectIds: [],
          pages: added,
        }
    if (!persist(next)) return
    setPaste("")
    setPasteError(null)
  }

  function changePageText(pageId: string, text: string) {
    const current = readingRef.current
    if (!current || !canSaveRef.current) return
    persist({
      ...current,
      pages: current.pages.map((page) => (page.id === pageId ? { ...page, text } : page)),
    })
  }

  function movePage(index: number, direction: -1 | 1) {
    const current = readingRef.current
    if (!current || !canSaveRef.current) return
    const target = index + direction
    if (target < 0 || target >= current.pages.length) return
    const pages = current.pages.slice()
    const [page] = pages.splice(index, 1)
    if (!page) return
    pages.splice(target, 0, page)
    persist({ ...current, pages })
  }

  function joinWithNext(index: number) {
    const current = readingRef.current
    if (!current || !canSaveRef.current) return
    const page = current.pages[index]
    const next = current.pages[index + 1]
    if (!page || !next) return
    const result = joinPages(page.text, next.text)
    if (!result.ok) return
    const pages = current.pages.slice()
    pages[index] = { ...page, text: result.text }
    pages.splice(index + 1, 1)
    persist({ ...current, pages })
  }

  function splitAtCaret(index: number) {
    const current = readingRef.current
    if (!current || !canSaveRef.current) return
    if (current.pages.length >= 8) return
    const page = current.pages[index]
    if (!page) return
    const caret = carets[page.id]
    if (!caret || caret.start !== caret.end) return
    const result = splitPageAt(page.text, caret.start)
    if (!result.ok) return
    const pages = current.pages.slice()
    pages[index] = { ...page, text: result.left }
    pages.splice(index + 1, 0, blankPage(result.right))
    persist({ ...current, pages })
  }

  function confirmBudget() {
    const current = readingRef.current
    if (!current || !canSaveRef.current || quota.status !== "ready") return
    const count = parseSceneCount(sceneCount)
    const cap = maxConfirmable({
      isFirstConfirmation: !current.hasConfirmedBudget,
      pagesWithoutScene: current.pages.filter((page) => page.scene === null).length,
      sceneCreatesRemaining: quota.sceneCreatesRemaining,
    })
    if (count === null || count < 1 || count > cap) return
    persist({
      ...current,
      hasConfirmedBudget: true,
      budgetRemaining: nextBudget(current.budgetRemaining, count, !current.hasConfirmedBudget),
    })
  }

  function startOver() {
    if (!readingRef.current) return
    if (!window.confirm("Start over and remove this reading?")) return
    readingEpoch.current += 1
    stopAllPolling()
    attemptKeys.current = {}
    postingRef.current = false
    setIllustrateBusy(false)
    setPageNotes({})
    setAwaitingCheck({})
    setOnPageId(null)
    canSaveRef.current = false
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(() => clearReading())
      .then(() => {
        readingRef.current = null
        canSaveRef.current = true
        setReading(null)
        setPaste("")
        setPasteError(null)
        setPhotoMessage(null)
        setSceneCount("")
        setCarets({})
      })
      .catch(() => {
        canSaveRef.current = true
      })
  }

  function clearPageNote(pageId: string) {
    setPageNotes((current) => {
      if (!(pageId in current)) return current
      const next = { ...current }
      delete next[pageId]
      return next
    })
  }

  function clearAwaitingCheck(pageId: string) {
    setAwaitingCheck((current) => {
      if (!current[pageId]) return current
      const next = { ...current }
      delete next[pageId]
      return next
    })
  }

  function stopPolling(pageId: string) {
    const timer = pollTimers.current[pageId]
    if (!timer) return
    clearInterval(timer.interval)
    clearTimeout(timer.timeout)
    delete pollTimers.current[pageId]
  }

  function stopAllPolling() {
    for (const pageId of Object.keys(pollTimers.current)) stopPolling(pageId)
  }

  function keyForPost(pageId: string, scene: Scene | null, replacing: boolean): string {
    const current = attemptKeys.current[pageId]
    if (replacing && scene) {
      if (current?.replacingProjectId === scene.projectId) return current.key
      const key = crypto.randomUUID()
      attemptKeys.current[pageId] = { key, replacingProjectId: scene.projectId }
      return key
    }
    if (current) return current.key
    const key = crypto.randomUUID()
    attemptKeys.current[pageId] = { key, replacingProjectId: null }
    return key
  }

  function focusBudget() {
    const input = budgetCountRef.current
    if (!input) return
    input.scrollIntoView({ block: "center" })
    input.focus()
  }

  async function readErrorCode(response: Response): Promise<string | null> {
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.error === "string") return body.error
    } catch {
      return null
    }
    return null
  }

  async function storeCompletedScene(pageId: string, projectId: string, image: Blob, epoch: number) {
    if (readingEpoch.current !== epoch) return
    const latest = readingRef.current
    if (!latest) return
    const page = latest.pages.find((item) => item.id === pageId)
    if (!page?.scene || page.scene.projectId !== projectId) return
    const saved = persist({
      ...latest,
      pages: latest.pages.map((item) =>
        item.id === pageId && item.scene?.projectId === projectId
          ? { ...item, scene: { ...item.scene, status: "complete", image } }
          : item,
      ),
    })
    if (!saved) return
    clearAwaitingCheck(pageId)
    clearPageNote(pageId)
    const pending = saveChainRef.current
    await pending
    if (readingEpoch.current !== epoch) return
    const after = readingRef.current?.pages.find((item) => item.id === pageId)
    if (after?.scene?.projectId !== projectId || after.scene.status !== "complete" || !after.scene.image) return
    try {
      await fetch(`/api/scenes/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      })
    } catch {
      return
    }
  }

  function restoreRefund(pageId: string, projectId: string) {
    const latest = readingRef.current
    if (!latest) return
    if (latest.restoredProjectIds.includes(projectId)) return
    const page = latest.pages.find((item) => item.id === pageId)
    if (!page?.scene || page.scene.projectId !== projectId) return
    persist({
      ...latest,
      budgetRemaining: latest.budgetRemaining + 1,
      restoredProjectIds: [...latest.restoredProjectIds, projectId],
      pages: latest.pages.map((item) => (item.id === pageId ? { ...item, scene: null } : item)),
    })
    clearAwaitingCheck(pageId)
    clearPageNote(pageId)
  }

  function markDownloadFailed(pageId: string, projectId: string) {
    const latest = readingRef.current
    if (!latest) return
    const page = latest.pages.find((item) => item.id === pageId)
    if (!page?.scene || page.scene.projectId !== projectId) return
    persist({
      ...latest,
      pages: latest.pages.map((item) =>
        item.id === pageId && item.scene?.projectId === projectId
          ? { ...item, scene: { ...item.scene, status: "download_failed" } }
          : item,
      ),
    })
    clearAwaitingCheck(pageId)
  }

  async function pollProject(pageId: string, projectId: string): Promise<"rendering" | "settled"> {
    const epoch = readingEpoch.current
    const page = readingRef.current?.pages.find((item) => item.id === pageId)
    if (!page?.scene || page.scene.projectId !== projectId) return "settled"
    if (page.scene.status !== "rendering" && page.scene.status !== "download_failed") {
      return "settled"
    }
    if (pollBusy.current[pageId]) return "rendering"
    pollBusy.current[pageId] = true
    try {
      let response: Response
      try {
        response = await fetch(`/api/scenes/${encodeURIComponent(projectId)}`, {
          credentials: "same-origin",
          cache: "no-store",
        })
      } catch {
        return "rendering"
      }
      if (readingEpoch.current !== epoch) return "settled"

      if (response.status === 502) {
        const error = await readErrorCode(response)
        if (readingEpoch.current !== epoch) return "settled"
        if (error === "download_failed") {
          markDownloadFailed(pageId, projectId)
          return "settled"
        }
        return "rendering"
      }

      const pictaStatus = response.headers.get("X-Picta-Status")
      const contentType = response.headers.get("content-type") ?? ""
      if (pictaStatus === "complete" || contentType.includes("image/png")) {
        const image = await response.blob()
        await storeCompletedScene(pageId, projectId, image, epoch)
        return "settled"
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return "rendering"
      }
      if (readingEpoch.current !== epoch) return "settled"
      if (isRecord(payload) && payload.status === "refunded") {
        restoreRefund(pageId, projectId)
        return "settled"
      }
      return "rendering"
    } finally {
      pollBusy.current[pageId] = false
    }
  }

  function startPolling(pageId: string, projectId: string) {
    stopPolling(pageId)
    clearAwaitingCheck(pageId)
    const interval = setInterval(() => {
      if (pollBusy.current[pageId]) return
      void pollProject(pageId, projectId).then((outcome) => {
        if (outcome !== "rendering") stopPolling(pageId)
      })
    }, SCENE_POLL_MS)
    const timeout = setTimeout(() => {
      stopPolling(pageId)
      const page = readingRef.current?.pages.find((item) => item.id === pageId)
      if (page?.scene?.status === "rendering" && page.scene.projectId === projectId) {
        setAwaitingCheck((current) => ({ ...current, [pageId]: true }))
      }
    }, SCENE_POLL_LIMIT_MS)
    pollTimers.current[pageId] = { interval, timeout }
  }

  async function checkAgain(pageId: string) {
    if (checkLocks.current[pageId]) return
    const page = readingRef.current?.pages.find((item) => item.id === pageId)
    if (!page?.scene || (page.scene.status !== "rendering" && page.scene.status !== "download_failed")) return
    const projectId = page.scene.projectId
    const epoch = readingEpoch.current
    checkLocks.current[pageId] = true
    clearAwaitingCheck(pageId)
    try {
      while (pollBusy.current[pageId]) {
        if (readingEpoch.current !== epoch) return
        await new Promise((resolve) => {
          window.setTimeout(resolve, 50)
        })
      }
      if (readingEpoch.current !== epoch) return
      const latest = readingRef.current?.pages.find((item) => item.id === pageId)
      if (
        !latest?.scene ||
        latest.scene.projectId !== projectId ||
        (latest.scene.status !== "rendering" && latest.scene.status !== "download_failed")
      ) {
        return
      }
      const outcome = await pollProject(pageId, projectId)
      if (readingEpoch.current !== epoch) return
      if (outcome !== "rendering") return
      const after = readingRef.current?.pages.find((item) => item.id === pageId)
      if (after?.scene?.status === "rendering" && after.scene.projectId === projectId) {
        startPolling(pageId, projectId)
      }
    } finally {
      delete checkLocks.current[pageId]
    }
  }

  function noteForStatus(status: number, error: string | null): string {
    if (status === 400) return "That page could not be illustrated."
    if (status === 402) return "Picta is out of image credits."
    if (status === 409) return "That illustration is already in progress."
    if (status === 429) {
      return error === "busy" ? "Another illustration is still running." : "The illustration limit is full."
    }
    if (status === 502) return "Couldn't start the scene."
    return "Illustration is unavailable."
  }

  async function requestScene(pageId: string, pageText: string, key: string) {
    const epoch = readingEpoch.current
    clearPageNote(pageId)
    let response: Response
    try {
      response = await fetch("/api/scenes", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ pageText }),
      })
    } catch {
      if (readingEpoch.current !== epoch) return
      setPageNotes((notes) => ({ ...notes, [pageId]: "Illustration is unavailable." }))
      return
    }
    if (readingEpoch.current !== epoch) return

    if (!response.ok) {
      const error = response.status === 429 || response.status === 502 ? await readErrorCode(response) : null
      if (readingEpoch.current !== epoch) return
      setPageNotes((notes) => ({ ...notes, [pageId]: noteForStatus(response.status, error) }))
      return
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      if (readingEpoch.current !== epoch) return
      setPageNotes((notes) => ({ ...notes, [pageId]: "Illustration is unavailable." }))
      return
    }
    if (readingEpoch.current !== epoch) return

    if (isRejectedScene(payload)) {
      setPageNotes((notes) => ({ ...notes, [pageId]: payload.reason }))
      return
    }
    if (!isAllowedScene(payload)) {
      setPageNotes((notes) => ({ ...notes, [pageId]: "Illustration is unavailable." }))
      return
    }

    const latest = readingRef.current
    if (!latest) return
    const page = latest.pages.find((item) => item.id === pageId)
    if (!page) return
    if (page.scene?.projectId === payload.projectId && page.scene.status === "complete" && page.scene.image) {
      return
    }
    const sameProject = page.scene?.projectId === payload.projectId
    const scene: Scene = {
      projectId: payload.projectId,
      moment: payload.moment,
      imagePrompt: payload.imagePrompt,
      creditsCharged: payload.creditsCharged,
      status: "rendering",
      image: null,
      simulated: payload.simulated === true,
    }
    const saved = persist({
      ...latest,
      budgetRemaining: sameProject ? latest.budgetRemaining : Math.max(0, latest.budgetRemaining - 1),
      pages: latest.pages.map((item) => (item.id === pageId ? { ...item, scene } : item)),
    })
    if (!saved) return
    startPolling(pageId, payload.projectId)
  }

  function illustratePage(pageId: string) {
    const current = readingRef.current
    if (!current || !canSaveRef.current || postingRef.current) return
    const page = current.pages.find((item) => item.id === pageId)
    if (!page) return
    if (current.pages.some((item) => item.scene?.status === "rendering")) return

    const replacing = page.scene?.status === "complete"
    if (replacing && !window.confirm("Replace this scene?")) return
    if (!current.hasConfirmedBudget || current.budgetRemaining === 0) {
      setPageNotes((notes) => ({ ...notes, [pageId]: "Confirm a scene budget first." }))
      focusBudget()
      return
    }

    const key = keyForPost(pageId, page.scene, replacing)
    postingRef.current = true
    setIllustrateBusy(true)
    void requestScene(pageId, page.text, key).finally(() => {
      postingRef.current = false
      setIllustrateBusy(false)
    })
  }

  pollingApi.current = { start: startPolling, stopAll: stopAllPolling }

  const enteredCount = parseSceneCount(sceneCount)
  const sceneCreatesRemaining = quota.status === "ready" ? quota.sceneCreatesRemaining : null
  const confirmCap =
    reading && sceneCreatesRemaining !== null
      ? maxConfirmable({
          isFirstConfirmation: !reading.hasConfirmedBudget,
          pagesWithoutScene: reading.pages.filter((page) => page.scene === null).length,
          sceneCreatesRemaining,
        })
      : 0
  const confirmDisabled =
    sceneCreatesRemaining === null || enteredCount === null || enteredCount < 1 || enteredCount > confirmCap
  const illustrationRunning = reading?.pages.some((page) => page.scene?.status === "rendering") ?? false

  return (
    <div className="reading-screen">
      <h1>Picta</h1>
      {phase === "loading" ? <main>Loading…</main> : null}
      {phase === "error" ? <main>The reading could not be loaded.</main> : null}
      {phase === "ready" ? (
        <main>
          <div className="reading-paste">
            <textarea
              className="paste-box"
              value={paste}
              aria-label="Excerpt"
              onChange={(event) => setPaste(event.target.value)}
            />
            {pasteError ? <p className="reading-message">{pasteError}</p> : null}
            <div className="action-row">
              <button type="button" onClick={addPages}>
                Add pages
              </button>
            </div>
          </div>

          <div className="reading-paste">
            <input
              className="page-photo"
              type="file"
              accept="image/jpeg, image/png, image/webp"
              aria-label="Add a page photo"
              disabled={photoBusy}
              onChange={(event) => {
                choosePhoto(event.currentTarget)
              }}
            />
            {photoMessage ? <p className="reading-message">{photoMessage}</p> : null}
          </div>

          {reading && reading.pages.length > 0 ? (
            <div className="page-stack">
              {reading.pages.map((page, index) => {
                const next = reading.pages[index + 1]
                const joined = next ? joinPages(page.text, next.text) : null
                const caret = carets[page.id]
                const collapsed = caret !== undefined && caret.start === caret.end
                const split = collapsed ? splitPageAt(page.text, caret.start) : null
                const showJoin = joined?.ok === true
                const showSplit = reading.pages.length < 8 && split?.ok === true
                const showIllustrate =
                  page.scene === null ||
                  page.scene.status === "complete" ||
                  page.scene.status === "download_failed"
                const sceneImage =
                  page.scene?.status === "complete" && page.scene.image ? page.scene.image : null
                return (
                  <article className="page-card" key={page.id}>
                    <div className="page-body">
                      <textarea
                        className="page-text"
                        value={page.text}
                        aria-label={`Page ${index + 1}`}
                        onChange={(event) => changePageText(page.id, event.target.value)}
                        onSelect={(event) => rememberCaret(page.id, event.currentTarget)}
                        onKeyUp={(event) => rememberCaret(page.id, event.currentTarget)}
                        onClick={(event) => rememberCaret(page.id, event.currentTarget)}
                      />
                      {sceneImage ? (
                        <SceneImage image={sceneImage} simulated={page.scene?.simulated === true} />
                      ) : null}
                      {onPageId === page.id && page.photo && sceneImage ? (
                        <div className="on-page-overlay">
                          <OnPageView
                            photo={page.photo}
                            scene={sceneImage}
                            onClose={() => setOnPageId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                    {page.scene?.status === "rendering" && !awaitingCheck[page.id] ? (
                      <p className="reading-message">Illustrating…</p>
                    ) : null}
                    {page.scene?.status === "download_failed" ? (
                      <p className="reading-message">The scene could not be downloaded.</p>
                    ) : null}
                    {pageNotes[page.id] ? <p className="reading-message">{pageNotes[page.id]}</p> : null}
                    <div className="action-row">
                      <button type="button" onClick={() => movePage(index, -1)} disabled={index === 0}>
                        Move earlier
                      </button>
                      <button
                        type="button"
                        onClick={() => movePage(index, 1)}
                        disabled={index === reading.pages.length - 1}
                      >
                        Move later
                      </button>
                      {showJoin ? (
                        <button type="button" onClick={() => joinWithNext(index)}>
                          Join with next
                        </button>
                      ) : null}
                      {showSplit ? (
                        <button type="button" onClick={() => splitAtCaret(index)}>
                          Split
                        </button>
                      ) : null}
                      {showIllustrate ? (
                        <button
                          type="button"
                          onClick={() => illustratePage(page.id)}
                          disabled={illustrationRunning || illustrateBusy}
                        >
                          Illustrate
                        </button>
                      ) : null}
                      {page.photo && sceneImage ? (
                        <button type="button" onClick={() => setOnPageId(page.id)}>
                          See it on the page
                        </button>
                      ) : null}
                      {page.scene?.status === "download_failed" ||
                      (page.scene?.status === "rendering" && awaitingCheck[page.id]) ? (
                        <button type="button" onClick={() => void checkAgain(page.id)}>
                          Check again
                        </button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}

          {reading && reading.pages.length > 0 ? (
            <section className="budget">
              <p>Remaining budget: {reading.budgetRemaining}</p>
              {quota.status === "error" ? <p>The limit could not be loaded.</p> : null}
              {quota.status === "ready" &&
              quota.sceneCreatesRemaining === 0 &&
              quota.sceneWindowResetsAt > 0 ? (
                <p>The scene limit resets at {new Date(quota.sceneWindowResetsAt).toLocaleString()}.</p>
              ) : null}
              <input
                ref={budgetCountRef}
                className="budget-count"
                type="number"
                step={1}
                value={sceneCount}
                aria-label="Scene count"
                onChange={(event) => setSceneCount(event.target.value)}
              />
              <p>About {estimateCredits(enteredCount ?? 0)} credits</p>
              <div className="action-row">
                <button type="button" onClick={confirmBudget} disabled={confirmDisabled}>
                  Confirm
                </button>
              </div>
            </section>
          ) : null}

          {reading ? (
            <div className="start-over">
              <button type="button" onClick={startOver}>
                Start over
              </button>
            </div>
          ) : null}
        </main>
      ) : null}
    </div>
  )
}
