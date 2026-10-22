const MAX_PASTE_LENGTH = 20_000
const MAX_SECTION_LENGTH = 2_500
const MAX_PAGES = 8
const MAX_JOIN_LENGTH = 5_000

export type SplitResult =
  | { ok: true; pages: string[] }
  | { ok: false; reason: "empty" | "too_long" | "too_many_pages" }

export function splitPaste(input: string): SplitResult {
  const normalized = input.replace(/\r\n/g, "\n").trim()
  if (normalized.length === 0) return { ok: false, reason: "empty" }
  if (normalized.length > MAX_PASTE_LENGTH) return { ok: false, reason: "too_long" }

  const pages: string[] = []
  for (const section of sectionsOnRule(normalized)) {
    const trimmed = section.trim()
    if (trimmed.length === 0) continue
    const nextPages =
      trimmed.length <= MAX_SECTION_LENGTH ? [trimmed] : packParagraphs(trimmed)
    for (const page of nextPages) {
      pages.push(page)
      if (pages.length > MAX_PAGES) return { ok: false, reason: "too_many_pages" }
    }
  }

  if (pages.length === 0) return { ok: false, reason: "empty" }
  return { ok: true, pages }
}

export function joinPages(
  left: string,
  right: string,
): { ok: true; text: string } | { ok: false; reason: "too_long" } {
  const text = `${left.trim()}\n\n${right.trim()}`
  if (text.length > MAX_JOIN_LENGTH) return { ok: false, reason: "too_long" }
  return { ok: true, text }
}

export function splitPageAt(
  text: string,
  index: number,
): { ok: true; left: string; right: string } | { ok: false; reason: "empty_side" } {
  const offset = index < 0 ? 0 : index
  const left = text.slice(0, offset)
  const right = text.slice(offset)
  if (left.trim() === "" || right.trim() === "") return { ok: false, reason: "empty_side" }
  return { ok: true, left, right }
}

function sectionsOnRule(text: string): string[] {
  const sections: string[] = []
  let lines: string[] = []
  for (const line of text.split("\n")) {
    if (line === "---") {
      sections.push(lines.join("\n"))
      lines = []
    } else {
      lines.push(line)
    }
  }
  sections.push(lines.join("\n"))
  return sections
}

function packParagraphs(section: string): string[] {
  const pages: string[] = []
  let current = ""
  for (const paragraph of section.split("\n\n")) {
    if (current === "") {
      current = paragraph
      continue
    }
    const candidate = `${current}\n\n${paragraph}`
    if (candidate.length > MAX_SECTION_LENGTH) {
      pages.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current !== "") pages.push(current)
  return pages
}
