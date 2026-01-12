import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export function getPerfDelay(): number {
  try {
    if (typeof window === "undefined") return 100
    const key = "perfDelay"
    const override = window.localStorage.getItem(key)
    if (override) {
      const v = Number(override)
      if (!Number.isNaN(v)) return clamp(v, 0, 150)
    }
    const env = (process.env.NEXT_PUBLIC_PERF_DELAY as any)
    if (env) {
      const v = Number(env)
      if (!Number.isNaN(v)) return clamp(v, 0, 150)
    }
    let d = 100
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection
    if (conn?.effectiveType) {
      const t = String(conn.effectiveType)
      if (t === "slow-2g" || t === "2g") d = 140
      else if (t === "3g") d = 120
      else if (t === "4g") d = 100
    }
    if (typeof conn?.rtt === "number") {
      if (conn.rtt > 300) d = 150
      else if (conn.rtt > 200) d = Math.max(d, 130)
    }
    const cores = (navigator as any).hardwareConcurrency
    const mem = (navigator as any).deviceMemory
    if (typeof cores === "number" && cores <= 2) d = Math.max(d, 130)
    if (typeof mem === "number" && mem <= 4) d = Math.max(d, 120)
    return clamp(d, 0, 150)
  } catch {
    return 100
  }
}
