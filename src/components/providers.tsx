"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme (Untitled UI uses `.dark-mode` / `.light-mode`). The React Aria RouterProvider that sat
 * here was dead weight on every page: no public component renders a React Aria link (audit P-10).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" value={{ light: "light-mode", dark: "dark-mode" }} defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
