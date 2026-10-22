function socketOrUnknown(socketAddress: string | null): string {
  if (socketAddress === null || socketAddress === "") return "unknown"
  return socketAddress
}

function leftmostForwarded(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded === null) return null
  const token = forwarded
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  return token ?? null
}

export function clientIp(headers: Headers, socketAddress: string | null): string {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = leftmostForwarded(headers)
    if (forwarded !== null) return forwarded
  }
  return socketOrUnknown(socketAddress)
}
