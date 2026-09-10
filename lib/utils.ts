import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * An id taken from a URL or a form: a positive whole number, or null. Every
 * id in the database is a bigint, so anything else can never match a row, and
 * refusing it here keeps a hand-edited URL from reaching a query as garbage.
 */
export function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
