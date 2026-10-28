"use client"

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from "react"
import {
  canSubmitKeys,
  GEMINI_KEY_HEADER,
  MAGIC_HOUR_KEY_HEADER,
  MAX_API_KEY_LENGTH,
  usableApiKey,
} from "@/lib/api-key-headers"
import { directScenePrompt, MAX_DIRECT_PROMPT } from "@/lib/direct-scene"
import { clearReading, loadReading, saveReading } from "@/lib/reading-store"
import type { Page, Reading, Scene } from "@/lib/types"
import { OnPageView } from "./on-page-view"

const MAX_EXCERPT = 5000

type Phase = "loading" | "error" | "ready"

type PendingAction =
  | { kind: "photo"; file: File }
  | { kind: "scene"; pageId: string }
  | { kind: "poll"; pageId: string; projectId: string }

type KeyMemory = {
  gemini: "unset" | "server" | { typed: string }
  magicHour: string | null
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

function KeyField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="key-field light-capsule" htmlFor={id}>
      <span className="key-field__label">{label}</span>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Enter your ${label}`}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="key-field__seal" aria-hidden="true">
        ✦
      </span>
    </label>
  )
}

function PageCorners({ side }: { side: "left" | "right" }) {
  return (
    <>
      <div className={`page__corner page__corner--top-${side}`} />
      <div className={`page__corner page__corner--bottom-${side}`} />
    </>
  )
}

function FrameOrnaments() {
  return (
    <>
      <div className="mystery-frame__ornament mystery-frame__ornament--top" />
      <div className="mystery-frame__ornament mystery-frame__ornament--bottom" />
    </>
  )
}

function PhotoPreview({ image }: { image: Blob }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(image)
    setSrc(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [image])

  if (!src) return null
  return <img src={src} alt="Uploaded page" />
}

function geminiHint(input: {
  purpose: "photo" | "scene"
  requireTypedGemini: boolean
  serverHasGemini: boolean
}): string {
  if (input.purpose === "photo") {
    if (input.requireTypedGemini) return "The server key was rejected. Enter a Gemini key to read the photo."
    if (input.serverHasGemini) return "Leave the Gemini key blank to use the key on this server."
    return "A Gemini key is needed to read a photo."
  }
  if (input.requireTypedGemini) {
    return "The server Gemini key was rejected. Enter another, or leave it blank to send your description straight to Magic Hour."
  }
  if (input.serverHasGemini) return "Leave the Gemini key blank to use the key on this server."
  return "Gemini is optional. Without it, your description goes straight to Magic Hour, up to 1,500 characters."
}

function followLight(event: MouseEvent<HTMLElement>) {
  event.currentTarget.style.setProperty("--lx", `${event.clientX}px`)
  event.currentTarget.style.setProperty("--ly", `${event.clientY}px`)
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

  if (!src) return null
  return <img src={src} alt={simulated ? "Simulated scene" : "Scene"} />
}

export default function ReadingScreen() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [reading, setReading] = useState<Reading | null>(null)
  const [paste, setPaste] = useState("")
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [photoMessage, setPhotoMessage] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoOver, setPhotoOver] = useState(false)
  const [chosenPhoto, setChosenPhoto] = useState<File | null>(null)

  const readingRef = useRef<Reading | null>(null)
  const canSaveRef = useRef(false)
  const saveChainRef = useRef(Promise.resolve())
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
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const [geminiDraft, setGeminiDraft] = useState("")
  const [magicHourDraft, setMagicHourDraft] = useState("")
  const [serverHasGemini, setServerHasGemini] = useState(false)
  const [requireTypedGemini, setRequireTypedGemini] = useState(false)
  const [keyConfigLoading, setKeyConfigLoading] = useState(true)
  const [keyAsk, setKeyAsk] = useState<PendingAction["kind"] | null>(null)
  const [workPhase, setWorkPhase] = useState<"writing" | "sending" | null>(null)

  const keysRef = useRef<KeyMemory>({ gemini: "unset", magicHour: null })
  const requireTypedGeminiRef = useRef(false)
  const dialogOpenRef = useRef(false)
  const keysDismissedRef = useRef(false)
  const pendingActionRef = useRef<PendingAction | null>(null)

  useEffect(() => {
    let cancelled = false
    loadReading()
      .then((stored) => {
        if (cancelled) return
        const single =
          stored && stored.pages.length > 1 ? { ...stored, pages: stored.pages.slice(0, 1) } : stored
        readingRef.current = single
        canSaveRef.current = true
        setReading(single)
        setPhase("ready")
        if (single && stored && stored.pages.length > 1) void saveReading(single)
      })
      .catch(() => {
        if (cancelled) return
        setPhase("error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (phase !== "ready") return
    void refreshServerGemini()
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

  useEffect(() => {
    const magicHour = usableApiKey(magicHourDraft)
    if (magicHour === null) {
      if (magicHourDraft.trim() === "") {
        keysRef.current = { gemini: keysRef.current.gemini, magicHour: null }
      }
      return
    }
    const gemini = usableApiKey(geminiDraft)
    if (gemini !== null) {
      keysRef.current = { gemini: { typed: gemini }, magicHour }
      if (requireTypedGeminiRef.current) {
        requireTypedGeminiRef.current = false
        setRequireTypedGemini(false)
      }
      return
    }
    if (geminiDraft.trim() === "") {
      keysRef.current = {
        gemini: serverHasGemini && !requireTypedGeminiRef.current ? "server" : "unset",
        magicHour,
      }
    }
  }, [geminiDraft, magicHourDraft, serverHasGemini])

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

  function geminiHeaders(): Record<string, string> {
    const gemini = keysRef.current.gemini
    if (typeof gemini === "object") return { [GEMINI_KEY_HEADER]: gemini.typed }
    return {}
  }

  function magicHeaders(): Record<string, string> {
    const magicHour = keysRef.current.magicHour
    if (magicHour === null) return {}
    return { [MAGIC_HOUR_KEY_HEADER]: magicHour }
  }

  function providerKeysReady(kind: "photo" | "scene" | "poll"): boolean {
    if (keysRef.current.magicHour === null) return false
    if (kind === "photo") return keysRef.current.gemini !== "unset"
    return true
  }

  async function refreshServerGemini() {
    setKeyConfigLoading(true)
    try {
      const response = await fetch("/api/quota", { credentials: "same-origin", cache: "no-store" })
      if (!response.ok) {
        setServerHasGemini(false)
        return
      }
      const body: unknown = await response.json()
      setServerHasGemini(isRecord(body) && body.geminiConfigured === true)
    } catch {
      setServerHasGemini(false)
    } finally {
      setKeyConfigLoading(false)
    }
  }

  function openKeyDialog(pending: PendingAction, message: string | null) {
    pendingActionRef.current = pending
    dialogOpenRef.current = true
    keysDismissedRef.current = false
    setKeyMessage(message)
    setKeyAsk(pending.kind)
    setKeyDialogOpen(true)
    void refreshServerGemini()
  }

  function rememberKeys(geminiRequired: boolean): boolean {
    const magicHour = usableApiKey(magicHourDraft)
    if (magicHour === null) return false
    const gemini = usableApiKey(geminiDraft)
    if (gemini !== null) {
      keysRef.current = { gemini: { typed: gemini }, magicHour }
      requireTypedGeminiRef.current = false
      setRequireTypedGemini(false)
      return true
    }
    if (geminiDraft.trim().length > MAX_API_KEY_LENGTH) return false
    if (serverHasGemini && !requireTypedGeminiRef.current) {
      keysRef.current = { gemini: "server", magicHour }
      return true
    }
    if (!geminiRequired) {
      keysRef.current = { gemini: "unset", magicHour }
      return true
    }
    return false
  }

  function rejectKeys(sentTypedGemini: boolean, pending: PendingAction) {
    keysRef.current = { gemini: "unset", magicHour: null }
    requireTypedGeminiRef.current = !sentTypedGemini
    setRequireTypedGemini(!sentTypedGemini)
    setGeminiDraft("")
    setMagicHourDraft("")
    openKeyDialog(pending, "Those keys were rejected.")
  }

  function rejectMagicHour(pending: PendingAction) {
    keysRef.current = { gemini: keysRef.current.gemini, magicHour: null }
    setMagicHourDraft("")
    openKeyDialog(pending, "That Magic Hour key was rejected.")
  }

  function cancelKeys() {
    const pending = pendingActionRef.current
    pendingActionRef.current = null
    if (pending?.kind === "poll") keysDismissedRef.current = true
    if (pending?.kind === "photo") setChosenPhoto(null)
    dialogOpenRef.current = false
    setKeyDialogOpen(false)
    setKeyAsk(null)
    setKeyMessage(null)
  }

  function submitKeys(event: FormEvent) {
    event.preventDefault()
    const pending = pendingActionRef.current
    if (!rememberKeys(pending?.kind === "photo")) return
    pendingActionRef.current = null
    dialogOpenRef.current = false
    keysDismissedRef.current = false
    setKeyDialogOpen(false)
    setKeyAsk(null)
    setKeyMessage(null)
    if (pending?.kind === "photo") void sendPhoto(pending.file)
    if (pending?.kind === "scene") illustratePage(pending.pageId)
    if (pending?.kind === "poll") {
      void pollProject(pending.pageId, pending.projectId).then((outcome) => {
        if (outcome === "rendering") startPolling(pending.pageId, pending.projectId)
      })
    }
  }

  function takePhotoFile(file: File | undefined) {
    if (!file) return
    if (file.type !== "image/jpeg" && file.type !== "image/png" && file.type !== "image/webp") {
      setPhotoMessage("Choose a JPEG, PNG, or WebP photo under 8 MB.")
      return
    }
    setPhotoMessage(null)
    if (!canSaveRef.current) return
    setChosenPhoto(file)
    void sendPhoto(file)
  }

  function choosePhoto(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ""
    takePhotoFile(file)
  }

  function dropPhoto(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setPhotoOver(false)
    if (photoBusy || readingRef.current?.pages.some((item) => item.scene?.status === "rendering")) return
    takePhotoFile(event.dataTransfer.files[0])
  }

  async function sendPhoto(file: File) {
    if (!providerKeysReady("photo")) {
      openKeyDialog({ kind: "photo", file }, null)
      return
    }
    setPhotoBusy(true)
    let kept = false
    try {
      const body = new FormData()
      body.append("image", file)
      let response: Response
      try {
        response = await fetch("/api/transcribe", {
          method: "POST",
          credentials: "same-origin",
          headers: geminiHeaders(),
          body,
        })
      } catch {
        setPhotoMessage("Transcription is unavailable.")
        return
      }
      if (response.status === 401) {
        const error = await readErrorCode(response)
        if (error === "rejected_api_key") {
          rejectKeys(typeof keysRef.current.gemini === "object", { kind: "photo", file })
          return
        }
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
      if (current?.pages.some((page) => page.scene?.status === "rendering")) {
        setPhotoMessage("An illustration is still running.")
        return
      }
      const existing = current?.pages[0]
      if (existing) stopPolling(existing.id)
      const page: Page = {
        id: existing?.id ?? crypto.randomUUID(),
        text: payload.text,
        photo: file,
        scene: null,
      }
      const next: Reading = current
        ? { ...current, pages: [page] }
        : {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            hasConfirmedBudget: false,
            budgetRemaining: 0,
            restoredProjectIds: [],
            pages: [page],
          }
      persist(next)
      kept = true
      setChosenPhoto(null)
      setPaste("")
      setPasteError(payload.text.trim().length > MAX_EXCERPT ? "That excerpt is too long." : null)
    } finally {
      setPhotoBusy(false)
      if (!kept && pendingActionRef.current?.kind !== "photo") setChosenPhoto(null)
    }
  }

  function changePageText(pageId: string, text: string) {
    const current = readingRef.current
    if (!current || !canSaveRef.current) return
    persist({
      ...current,
      pages: current.pages.map((page) => (page.id === pageId ? { ...page, text } : page)),
    })
  }

  function editExcerpt(value: string) {
    setPasteError(null)
    const existing = readingRef.current?.pages[0]
    if (!existing) {
      setPaste(value)
      return
    }
    changePageText(existing.id, value)
  }

  function submitExcerpt() {
    if (!canSaveRef.current || postingRef.current) return
    const current = readingRef.current
    if (current?.pages.some((page) => page.scene?.status === "rendering")) return
    const text = (current?.pages[0]?.text ?? paste).trim()
    if (text.length === 0) {
      setPasteError("That excerpt is empty.")
      return
    }
    if (text.length > MAX_EXCERPT) {
      setPasteError("That excerpt is too long.")
      return
    }
    setPasteError(null)
    const existing = current?.pages[0]
    const page: Page = existing ? { ...existing, text } : blankPage(text)
    const next: Reading = current
      ? { ...current, pages: [page] }
      : {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          hasConfirmedBudget: false,
          budgetRemaining: 0,
          restoredProjectIds: [],
          pages: [page],
        }
    if (!persist(next)) return
    setPaste("")
    illustratePage(page.id)
  }

  function startOver() {
    if (!readingRef.current) return
    if (!window.confirm("Start over and remove this reading?")) return
    readingEpoch.current += 1
    stopAllPolling()
    attemptKeys.current = {}
    postingRef.current = false
    setIllustrateBusy(false)
    setWorkPhase(null)
    setPageNotes({})
    setAwaitingCheck({})
    setOnPageId(null)
    setChosenPhoto(null)
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
    if (keysRef.current.magicHour === null) {
      if (!keysDismissedRef.current && !dialogOpenRef.current) {
        openKeyDialog({ kind: "poll", pageId, projectId }, null)
      }
      return "rendering"
    }
    if (pollBusy.current[pageId]) return "rendering"
    pollBusy.current[pageId] = true
    try {
      let response: Response
      try {
        response = await fetch(`/api/scenes/${encodeURIComponent(projectId)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: magicHeaders(),
        })
      } catch {
        return "rendering"
      }
      if (readingEpoch.current !== epoch) return "settled"

      if (response.status === 400 || response.status === 401) {
        const error = await readErrorCode(response)
        if (readingEpoch.current !== epoch) return "settled"
        if (error === "rejected_api_key") {
          rejectMagicHour({ kind: "poll", pageId, projectId })
          return "rendering"
        }
        if (error === "missing_api_key") {
          if (!dialogOpenRef.current) {
            openKeyDialog({ kind: "poll", pageId, projectId }, null)
          }
          return "rendering"
        }
      }

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
    if (status === 502) {
      if (error === "magic_hour") return "Magic Hour didn't start the image."
      if (error === "gemini_400") return "Gemini refused that page."
      if (error === "gemini_402") return "Gemini is out of credits."
      if (error === "gemini_404") return "Gemini doesn't offer that model for this key."
      if (error === "gemini_429") return "Gemini's rate limit is full."
      if (error === "gemini_busy") return "Gemini is busy. Try again in a moment."
      if (error === "gemini_parse") return "Gemini's reply could not be read."
      if (error === "gemini_unavailable") return "Gemini didn't answer."
      return "Couldn't start the scene."
    }
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
          ...geminiHeaders(),
          ...magicHeaders(),
        },
        body: JSON.stringify({ pageText }),
      })
    } catch {
      if (readingEpoch.current !== epoch) return
      setPageNotes((notes) => ({ ...notes, [pageId]: "Illustration is unavailable." }))
      return
    }
    if (readingEpoch.current !== epoch) return

    if (response.status === 401) {
      const error = await readErrorCode(response)
      if (readingEpoch.current !== epoch) return
      if (error === "rejected_api_key") {
        if (keysRef.current.gemini === "unset") {
          rejectMagicHour({ kind: "scene", pageId })
          return
        }
        rejectKeys(typeof keysRef.current.gemini === "object", { kind: "scene", pageId })
        return
      }
    }

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
    if (!providerKeysReady("scene")) {
      openKeyDialog({ kind: "scene", pageId }, null)
      return
    }

    const direct = keysRef.current.gemini === "unset"
    if (direct) {
      const prepared = directScenePrompt(page.text)
      if (!prepared.ok) {
        setPageNotes((notes) => ({ ...notes, [pageId]: prepared.reason }))
        return
      }
    }

    const key = keyForPost(pageId, page.scene, replacing)
    postingRef.current = true
    setIllustrateBusy(true)
    setWorkPhase(direct ? "sending" : "writing")
    void requestScene(pageId, page.text, key).finally(() => {
      postingRef.current = false
      setIllustrateBusy(false)
      setWorkPhase(null)
    })
  }

  pollingApi.current = { start: startPolling, stopAll: stopAllPolling }

  const page = reading?.pages[0] ?? null
  const excerpt = page?.text ?? paste
  const shownPhoto = page?.photo ?? chosenPhoto
  const writing = excerpt.trim().length > 0
  const illustrationRunning = page?.scene?.status === "rendering"
  const sceneImage = page?.scene?.status === "complete" && page.scene.image ? page.scene.image : null
  const illustrating = page?.scene?.status === "rendering" && !awaitingCheck[page.id]
  const stillWorking = page ? awaitingCheck[page.id] === true : false
  const activity =
    workPhase === "writing"
      ? "Generating the scene prompt…"
      : workPhase === "sending"
        ? "Generating your picture with Magic Hour…"
        : illustrating
          ? "The picture is being drawn…"
          : null
  const visionCaption = sceneImage
    ? page?.scene?.simulated
      ? "Simulated scene"
      : null
    : activity
      ? activity
      : page?.scene?.status === "download_failed"
        ? "The scene could not be downloaded."
        : stillWorking
          ? "Still working"
          : "Your vision will be revealed here"
  const illustrateLabel = workPhase ? "Generating…" : illustrating ? "Illustrating" : "Illustrate"
  const liveStatus = activity ?? (stillWorking ? "Still working. Check again when you want." : null)
  const keyHint = geminiHint({
    purpose: keyAsk === "photo" ? "photo" : "scene",
    requireTypedGemini,
    serverHasGemini,
  })

  return (
    <div className="app-shell" onMouseMove={followLight}>
      <div className="ambient-glow ambient-glow--one" />
      <div className="ambient-glow ambient-glow--two" />

      <header className="masthead">
        <div className="brand">
          <span className="brand__flourish" aria-hidden="true">
            ◆
          </span>
          <h1>PICTA</h1>
          <span className="brand__flourish" aria-hidden="true">
            ◆
          </span>
        </div>

        <div className="keys" aria-label="API keys">
          <KeyField
            id="magic-hour-key"
            label="Magic Hour API key"
            value={magicHourDraft}
            onChange={setMagicHourDraft}
          />
          <KeyField
            id="gemini-key"
            label="Gemini API key"
            value={geminiDraft}
            onChange={setGeminiDraft}
          />
        </div>
        <p className="privacy-note">Your keys remain in this browser session.</p>
        {keyConfigLoading ? null : <p className="key-hint">{keyHint}</p>}
      </header>

      {phase === "loading" ? (
        <main className="screen-state">
          <p className="brand__eyebrow">Opening</p>
          <p>Loading…</p>
        </main>
      ) : null}
      {phase === "error" ? (
        <main className="screen-state">
          <p className="brand__eyebrow">Could not open</p>
          <p>The reading could not be loaded.</p>
        </main>
      ) : null}

      {phase === "ready" ? (
        <>
          <section className="book-stage" aria-label="Picta prompt book">
            <div className="book-shadow" />
            <div className="book">
              <div className="book__cover">
                <div className="book__gilt-frame" />
                <div className="book__pages">
                  <section className="page page--left">
                    <PageCorners side="left" />
                    <div
                      className={
                        shownPhoto ? "page-compose is-photo" : writing ? "page-compose is-writing" : "page-compose"
                      }
                    >
                      {shownPhoto ? null : (
                        <>
                          <label htmlFor="prompt" className="sr-only">
                            Excerpt
                          </label>
                          <textarea
                            id="prompt"
                            value={excerpt}
                            aria-label="Excerpt"
                            placeholder="Describe the scene you wish to see…"
                            onChange={(event) => editExcerpt(event.target.value)}
                          />
                        </>
                      )}
                      {writing && !shownPhoto ? null : (
                        <label
                          className={
                            photoOver || photoBusy ? "photo-well is-over" : "photo-well"
                          }
                          onDragEnter={(event) => {
                            event.preventDefault()
                            setPhotoOver(true)
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            setPhotoOver(true)
                          }}
                          onDragLeave={(event) => {
                            const next = event.relatedTarget
                            if (next instanceof Node && event.currentTarget.contains(next)) return
                            setPhotoOver(false)
                          }}
                          onDrop={dropPhoto}
                        >
                          <input
                            className="page-photo"
                            type="file"
                            accept="image/jpeg, image/png, image/webp"
                            aria-label="Add a page photo"
                            disabled={photoBusy || illustrationRunning === true}
                            onChange={(event) => {
                              choosePhoto(event.currentTarget)
                            }}
                          />
                          {shownPhoto ? <PhotoPreview image={shownPhoto} /> : null}
                          <span className="photo-well__title">
                            {photoBusy ? "Reading the photo…" : shownPhoto ? "Page photo" : "Drop a page photo"}
                          </span>
                          <span className="photo-well__hint">
                            {shownPhoto ? "Drop another, or click to replace" : "or click to upload"}
                          </span>
                        </label>
                      )}
                    </div>
                    {pasteError ? <p className="reading-message">{pasteError}</p> : null}
                    {page && pageNotes[page.id] ? <p className="reading-message">{pageNotes[page.id]}</p> : null}
                    {photoMessage ? <p className="reading-message">{photoMessage}</p> : null}
                    {shownPhoto ? null : (
                      <p
                        className={excerpt.length > MAX_DIRECT_PROMPT ? "page-count is-over" : "page-count"}
                        aria-label={`${excerpt.length} of ${MAX_DIRECT_PROMPT} characters`}
                      >
                        {excerpt.length}/{MAX_DIRECT_PROMPT}
                      </p>
                    )}
                    <p className="page__number">I</p>
                  </section>

                  <div className="book__spine" aria-hidden="true">
                    <span />
                  </div>

                  <section className="page page--right">
                    <PageCorners side="right" />
                    <div
                      className={activity ? "mystery-frame is-working" : "mystery-frame"}
                      aria-label={sceneImage ? "Scene" : "Generated image will appear here"}
                    >
                      {sceneImage ? (
                        <SceneImage image={sceneImage} simulated={page?.scene?.simulated === true} />
                      ) : (
                        <FrameOrnaments />
                      )}
                      {sceneImage ? null : (
                        <div className="question-mark" aria-hidden="true">
                          ?
                        </div>
                      )}
                      {sceneImage ? null : <p>{visionCaption}</p>}
                    </div>
                    {sceneImage && visionCaption ? <p className="page-footnote">{visionCaption}</p> : null}
                    {page?.scene?.status === "download_failed" ? (
                      <p className="reading-message">The scene could not be downloaded.</p>
                    ) : null}
                    {page?.photo && sceneImage ||
                    (page &&
                      (page.scene?.status === "download_failed" ||
                        (page.scene?.status === "rendering" && stillWorking))) ? (
                      <div className="page-actions">
                        {page?.photo && sceneImage ? (
                          <button type="button" className="light-capsule" onClick={() => setOnPageId(page.id)}>
                            See it on the page
                          </button>
                        ) : null}
                        {page &&
                        (page.scene?.status === "download_failed" ||
                          (page.scene?.status === "rendering" && stillWorking)) ? (
                          <button type="button" className="light-capsule" onClick={() => void checkAgain(page.id)}>
                            Check again
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {page && onPageId === page.id && page.photo && sceneImage ? (
                      <div className="on-page-overlay">
                        <OnPageView photo={page.photo} scene={sceneImage} onClose={() => setOnPageId(null)} />
                      </div>
                    ) : null}
                    <p className="page__number">II</p>
                  </section>
                </div>
              </div>
              <div className="book__ribbon" aria-hidden="true" />
            </div>
          </section>

          <div className="beneath">
            <button
              type="button"
              className="illustrate light-capsule"
              onClick={submitExcerpt}
              disabled={illustrationRunning === true || illustrateBusy}
              aria-busy={illustrationRunning === true || illustrateBusy}
            >
              {illustrateLabel}
            </button>
            {liveStatus ? (
              <p className="work-status" role="status" aria-live="polite">
                {liveStatus}
              </p>
            ) : null}
          </div>

          {reading ? (
            <div className="start-over">
              <button type="button" className="quiet" onClick={startOver}>
                Start over
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {keyDialogOpen ? (
        <div className="key-dialog-backdrop">
          <form
            className="key-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-dialog-title"
            onSubmit={submitKeys}
          >
            <h2 id="key-dialog-title">API keys</h2>
            <p className="privacy-note">Kept in this tab until you refresh.</p>
            {keyMessage ? <p className="key-dialog-message">{keyMessage}</p> : null}
            {keyConfigLoading ? null : <p className="key-hint">{keyHint}</p>}
            <KeyField
              id="dialog-gemini-key"
              label="Gemini API key"
              value={geminiDraft}
              onChange={setGeminiDraft}
            />
            <KeyField
              id="dialog-magic-hour-key"
              label="Magic Hour API key"
              value={magicHourDraft}
              onChange={setMagicHourDraft}
            />
            <div className="key-dialog-actions">
              <button type="button" className="quiet" onClick={cancelKeys}>
                Cancel
              </button>
              <button
                type="submit"
                className="light-capsule"
                disabled={
                  keyConfigLoading ||
                  !canSubmitKeys({
                    geminiDraft,
                    magicHourDraft,
                    geminiConfigured: serverHasGemini,
                    requireTypedGemini,
                    geminiRequired: keyAsk === "photo",
                  })
                }
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
