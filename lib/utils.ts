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

/**
 * Greek text folded the way member search does on the server: accents off,
 * lower case, final sigma made medial, so "μαρια" finds Μαρία.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
}

/**
 * What a Server Action call that never reached the server reads as. The usual
 * cause is a deploy: action ids change with every build, so a tab left open
 * across one holds a reference the new server has never heard of. A dropped
 * connection looks the same from here. Reloading fixes both, so the message
 * says so rather than naming either.
 */
export const CALL_FAILED =
  "Η σελίδα είναι παλιά ή χάθηκε η σύνδεση. Κάνε ανανέωση και δοκίμασε ξανά."

/**
 * Runs a Server Action from the client and turns a call that throws into the
 * ordinary refusal every caller here already handles. Without it a stale tab
 * takes the whole page down and everything typed or ticked on it goes too,
 * which is worst on exactly the screens that hold unsaved work.
 *
 * Safe for the actions that redirect: redirect() throws on the server, and
 * Next turns that into a 303 the client follows, so it never arrives here as
 * a rejected promise. Only a call that genuinely failed does.
 */
export async function attempt<T>(
  run: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await run()
  } catch {
    return { error: CALL_FAILED }
  }
}

/**
 * The same guard for a form action handed to useActionState, where React makes
 * the call rather than us. A refusal is a state update, so the form keeps
 * everything typed - the whole reason ActionForm submits through onSubmit.
 */
export function guarded<S extends { error: string } | undefined>(
  action: (prev: S, formData: FormData) => Promise<S>,
): (prev: S, formData: FormData) => Promise<S> {
  return async (prev, formData) => {
    try {
      return await action(prev, formData)
    } catch {
      return { error: CALL_FAILED } as S
    }
  }
}
