'use client';

import { Eye } from 'lucide-react';

/**
 * Marks a render as a preview.
 *
 * Preview serves the store's real catalogue through a design the merchant has
 * not adopted. That is the point — they need to see their own products — but
 * it means the page is momentarily lying about what a customer would get, so
 * it says so. The ribbon is also the way out: "exit" clears the preview cookie
 * and returns the live design.
 *
 * It stays visible inside the console's device preview too. In a 375px-wide
 * frame full of the merchant's own products, a standing reminder that this is
 * not yet their live store is worth the two lines it costs.
 */
export function PreviewRibbon({ templateName }: { templateName: string }) {
  return (
    <div
      role="status"
      // A fixed neutral palette, not the template's ink: on a dark design the
      // ink is near-white, and white text on it disappears. In the flow rather
      // than sticky, so it never sits on top of the store's own sticky header.
      className="relative z-[1400] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-neutral-950 px-4 py-2 text-center text-[13px] font-medium text-white print:hidden"
      data-preview-ribbon
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Previewing <span className="font-semibold">{templateName}</span> — your live store is
        unchanged
      </span>
      <a
        href="?__template=off"
        className="shrink-0 rounded-full border border-white/40 px-3 py-0.5 text-xs transition hover:bg-white hover:text-content"
      >
        Exit preview
      </a>
    </div>
  );
}
