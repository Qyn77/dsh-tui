/**
 * How a component reaches the string catalog.
 *
 * A React context rather than a prop, because six components need strings —
 * `Banner`, `StatusBar`, `MessageList`, `Prompt`, `SlashPalette`,
 * `ApprovalPrompt` — and several sit two levels below the root. Threading a
 * `lang` prop to all of them would add a parameter to every intermediate
 * component and to every frame test that constructs one, to carry a value that
 * changes about once per install.
 *
 * The context holds the *language*, not the catalog, and `useStrings` looks the
 * catalog up on each call. `catalog()` is a property read returning one of two
 * module-level constants, so the result is referentially stable without a memo
 * — and a context whose value is a plain string cannot accidentally re-render
 * the whole tree by handing consumers a fresh object on every root render.
 *
 * The default is English, so a component rendered outside a provider — which is
 * what several unit-level tests do — still has strings rather than crashing on
 * an `undefined` catalog. That default is also what keeps the existing
 * frame-level tests in `tests/` asserting English without having to know this
 * module exists.
 *
 * This file is the React half of the boundary `src/i18n.ts` defines; the
 * catalog itself imports neither React nor Ink, the same way `markdown.ts`
 * stays clear of `Markdown.tsx`.
 * @module @deepseek-ai/dsh-tui/hooks/useStrings
 */

import React, { createContext, useContext, type FC, type ReactNode } from 'react'
import { catalog, type Catalog, type Lang } from '../i18n.ts'

/** The active language. English when no provider is above the consumer. */
const LanguageContext = createContext<Lang>('en')

/** Props for {@link LanguageProvider}. */
export interface LanguageProviderProps {
  /** The language every descendant renders in. */
  lang: Lang
  children: ReactNode
}

/** Publish one language to the tree below. */
export const LanguageProvider: FC<LanguageProviderProps> = ({ lang, children }) => (
  <LanguageContext.Provider value={lang}>{children}</LanguageContext.Provider>
)

/**
 * The active language.
 *
 * Needed by the handful of consumers that pass a language *on* to a pure
 * module — the prompt hands it to `filterCommands` — rather than reading
 * strings themselves.
 * @returns the language published by the nearest {@link LanguageProvider}.
 */
export function useLang(): Lang {
  return useContext(LanguageContext)
}

/**
 * The active language's strings.
 * @returns the catalog for the language published by the nearest
 * {@link LanguageProvider}, or the English one when there is none.
 */
export function useStrings(): Catalog {
  return catalog(useLang())
}
