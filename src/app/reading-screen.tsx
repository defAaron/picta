"use client"

import { useEffect, useRef, useState } from "react"
import { estimateCredits, maxConfirmable, nextBudget } from "@/lib/budget"
import { joinPages, splitPageAt, splitPaste } from "@/lib/pages"
import { clearReading, loadReading, saveReading } from "@/lib/reading-store"
import type { Page, Reading } from "@/lib/types"

type Caret = {
  start: number
  end: number
}

type Phase = "loading" | "error" | "ready"

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

export default function ReadingScreen() {
  const [phase, setPhase] = useState<Phase>("loading")
  const [reading, setReading] = useState<Reading | null>(null)
  const [paste, setPaste] = useState("")
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [sceneCount, setSceneCount] = useState("")
  const [carets, setCarets] = useState<Record<string, Caret>>({})

  const readingRef = useRef<Reading | null>(null)
  const canSaveRef = useRef(false)
  const saveChainRef = useRef(Promise.resolve())

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
    if (!current || !canSaveRef.current) return
    const count = parseSceneCount(sceneCount)
    const cap = maxConfirmable({
      isFirstConfirmation: !current.hasConfirmedBudget,
      pagesWithoutScene: current.pages.filter((page) => page.scene === null).length,
      sceneCreatesRemaining: 8,
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
        setSceneCount("")
        setCarets({})
      })
      .catch(() => {
        canSaveRef.current = true
      })
  }

  const enteredCount = parseSceneCount(sceneCount)
  const confirmCap = reading
    ? maxConfirmable({
        isFirstConfirmation: !reading.hasConfirmedBudget,
        pagesWithoutScene: reading.pages.filter((page) => page.scene === null).length,
        sceneCreatesRemaining: 8,
      })
    : 0
  const confirmDisabled = enteredCount === null || enteredCount < 1 || enteredCount > confirmCap

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
                return (
                  <article className="page-card" key={page.id}>
                    <textarea
                      className="page-text"
                      value={page.text}
                      aria-label={`Page ${index + 1}`}
                      onChange={(event) => changePageText(page.id, event.target.value)}
                      onSelect={(event) => rememberCaret(page.id, event.currentTarget)}
                      onKeyUp={(event) => rememberCaret(page.id, event.currentTarget)}
                      onClick={(event) => rememberCaret(page.id, event.currentTarget)}
                    />
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
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}

          {reading && reading.pages.length > 0 ? (
            <section className="budget">
              <p>Remaining budget: {reading.budgetRemaining}</p>
              <input
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
