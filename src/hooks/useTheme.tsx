/**
 * How a component reaches the terminal's appearance.
 *
 * A React context rather than a prop, for the reason `useStrings.tsx` gives
 * about the language: the consumers sit at different depths, and threading a
 * prop to all of them would add a parameter to every intermediate component and
 * every frame test that builds one, to carry a value that changes about once
 * per install.
 *
 * The context holds the *appearance*, not the palette, and {@link usePalette}
 * looks the palette up on each call — the same shape, and the same reason:
 * `palette()` returns a fresh object, so a context whose value were the palette
 * would hand consumers a new identity on every root render and re-render the
 * whole tree. A context holding a plain string cannot.
 *
 * The default is `dark`, which is what shipped before this existed. That is
 * what lets a component rendered outside a provider — which is what several
 * unit-level tests do — keep drawing exactly what it drew, and why adding this
 * provider changed no existing test.
 * @module @deepseek-ai/dsh-tui/hooks/useTheme
 */

import React, { createContext, useContext, type FC, type ReactNode } from 'react'
import { palette, type Appearance, type Palette } from '../theme.ts'

/** The terminal's appearance. Dark when no provider is above the consumer. */
const AppearanceContext = createContext<Appearance>('dark')

/** Props for {@link ThemeProvider}. */
export interface ThemeProviderProps {
  /** The appearance every descendant draws for. */
  appearance: Appearance
  children: ReactNode
}

/** Publish one appearance to the tree below. */
export const ThemeProvider: FC<ThemeProviderProps> = ({ appearance, children }) => (
  <AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider>
)

/**
 * The terminal's appearance.
 * @returns the appearance published by the nearest {@link ThemeProvider}.
 */
export function useAppearance(): Appearance {
  return useContext(AppearanceContext)
}

/**
 * The hex colors for the terminal's appearance.
 * @returns the palette for the appearance published by the nearest
 * {@link ThemeProvider}, or the dark one when there is none.
 */
export function usePalette(): Palette {
  return palette(useAppearance())
}
