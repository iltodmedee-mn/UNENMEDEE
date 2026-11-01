"use client"

/**
 * Vendored from ElevenLabs UI (https://ui.elevenlabs.io, MIT) via `npx shadcn add`.
 * Adapted to Untitled UI theme tokens (bg-brand-solid, bg-secondary, text-primary, ...).
 * Re-running `shadcn add` overwrites these edits; see CLAUDE.md.
 */

import { memo, type ComponentProps } from "react"
import { Streamdown } from "streamdown"

import { cn } from "@/lib/utils"

type ResponseProps = ComponentProps<typeof Streamdown>

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      // No image download button: AI text has no images, and the control's fallback opened
      // the image URL in a new tab with window.opener (tabnabbing). Local edit, see CLAUDE.md.
      controls={{ image: false }}
      // No images at all: model text never needs one, and a reply carrying
      // "![](https://tracker/x.png)" made every reader's browser fetch that URL (streamdown 2
      // has no image allow-list). Local edit, see CLAUDE.md.
      components={{ img: () => null }}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = "Response"
