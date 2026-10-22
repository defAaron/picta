import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const srcRoot = path.join(root, "src")
const magicHourClient = path.join(srcRoot, "lib", "magic-hour.ts")
const emptyExampleKeys = ["GEMINI_API_KEY=", "MAGIC_HOUR_API_KEY=", "TRUSTED_PROXY="] as const
const serverModules = ["magic-hour", "gemini", "limits"] as const
const googleKeyMarker = ["AI", "za"].join("")
const secretKeyMarker = ["sk", "-"].join("")
const bearerMarker = ["Bear", "er "].join("")

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full))
      continue
    }
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(full)
    }
  }
  return files
}

function relative(file: string): string {
  return path.relative(root, file)
}

function maskComments(source: string): string {
  const chars = source.split("")
  const stack: Array<"'" | '"' | "`" | "${"> = []
  let i = 0

  const blank = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      if (chars[index] !== "\n") chars[index] = " "
    }
  }

  while (i < source.length) {
    const context = stack[stack.length - 1]
    const ch = source[i]
    const next = source[i + 1]

    if (context === "'" || context === '"') {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === context) stack.pop()
      i += 1
      continue
    }

    if (context === "`") {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === "`") {
        stack.pop()
        i += 1
        continue
      }
      if (ch === "$" && next === "{") {
        stack.push("${")
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (ch === "/" && next === "/") {
      const start = i
      i += 2
      while (i < source.length && source[i] !== "\n") i += 1
      blank(start, i)
      continue
    }

    if (ch === "/" && next === "*") {
      const start = i
      i += 2
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1
      const end = Math.min(source.length, i + 2)
      blank(start, end)
      i = end
      continue
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      stack.push(ch)
      i += 1
      continue
    }

    if (context === "${" && ch === "}") {
      stack.pop()
      i += 1
      continue
    }

    i += 1
  }

  return chars.join("")
}

function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g)].map((match) => match[1] ?? "")
}

function withoutExtension(specifier: string): string {
  return specifier.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "")
}

function isRelativeModule(specifier: string, name: string): boolean {
  return specifier.startsWith(".") && (specifier === name || specifier.endsWith(`/${name}`))
}

function isClientModule(source: string): boolean {
  return /^["']use client["'];?/.test(source.replace(/^\uFEFF/, "").trimStart())
}

function importsLimitsOrSqlite(source: string): boolean {
  return specifiers(maskComments(source)).some((specifier) => {
    const bare = withoutExtension(specifier)
    if (bare === "better-sqlite3" || bare.startsWith("better-sqlite3/")) return true
    if (bare === "@/lib/limits") return true
    return isRelativeModule(bare, "limits")
  })
}

function bearerViolations(file: string, source: string): boolean {
  let scanned = maskComments(source).split(`${bearerMarker}test-key`).join("")
  if (path.normalize(file) === path.normalize(magicHourClient)) {
    const fromApiKey = new RegExp(`${bearerMarker.trimEnd()}\\s+\\$\\{\\s*apiKey\\s*\\}`, "g")
    const concatenated = new RegExp(`["']${bearerMarker}["']\\s*\\+\\s*apiKey`, "g")
    scanned = scanned.replace(fromApiKey, "").replace(concatenated, "")
  }
  return scanned.includes(bearerMarker)
}

describe("security", () => {
  it("gitignores .env and data/limits.sqlite and leaves example keys empty", () => {
    for (const target of [".env", "data/limits.sqlite"]) {
      const result = spawnSync("git", ["check-ignore", "-v", "--", target], {
        cwd: root,
        encoding: "utf8",
      })
      expect(result.status, `${target}\n${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain(target)
    }

    const example = readFileSync(path.join(root, ".env.example"), "utf8")
    const lines = example.split(/\r?\n/)
    for (const keyLine of emptyExampleKeys) {
      const key = keyLine.slice(0, -1)
      const assignments = lines.filter((line) => line.startsWith(`${key}=`) || line.startsWith(`${key} =`))
      expect(assignments).toEqual([keyLine])
    }
  })

  it("rejects key material and stray bearer tokens under src", () => {
    const failures = sourceFiles(srcRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      const reasons: string[] = []
      if (source.includes(googleKeyMarker)) reasons.push(googleKeyMarker)
      if (source.includes(secretKeyMarker)) reasons.push(secretKeyMarker)
      if (bearerViolations(file, source)) reasons.push(bearerMarker.trimEnd())
      return reasons.length === 0 ? [] : [`${relative(file)} (${reasons.join(", ")})`]
    })
    expect(failures).toEqual([])
  })

  it("rejects console logging under src", () => {
    const pattern = /\bconsole\s*\.\s*(?:log|info|debug|warn|error)\b/
    const failures = sourceFiles(srcRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return pattern.test(source) ? [relative(file)] : []
    })
    expect(failures).toEqual([])
  })

  it("keeps server modules out of client components", () => {
    const failures = sourceFiles(srcRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      if (!isClientModule(source)) return []
      const imported = specifiers(maskComments(source)).filter((specifier) => {
        const bare = withoutExtension(specifier)
        return serverModules.some((name) => bare === `@/lib/${name}` || isRelativeModule(bare, name))
      })
      return imported.length === 0 ? [] : [`${relative(file)} imports ${imported.join(", ")}`]
    })
    expect(failures).toEqual([])
  })

  it("requires the nodejs runtime when a route imports sqlite or limits", () => {
    const routes = sourceFiles(path.join(srcRoot, "app", "api")).filter((file) => path.basename(file) === "route.ts")
    const failures = routes.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      if (!importsLimitsOrSqlite(source)) return []
      return source.includes('export const runtime = "nodejs"') ? [] : [relative(file)]
    })
    expect(failures).toEqual([])
  })
})
