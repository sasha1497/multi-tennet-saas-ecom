'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Monitor, RotateCw, Smartphone, Tablet } from 'lucide-react';
import {
  encodePreviewCustomization,
  MAX_ENCODED_LENGTH,
  SECTIONS_PARAM,
  type TemplateCustomization,
} from '@retailos/templates';
import { SegmentedControl, cn } from '@retailos/ui';

export type Device = 'desktop' | 'tablet' | 'mobile';

/** CSS width each device frame renders the storefront at. */
const WIDTH: Record<Device, number> = { desktop: 1280, tablet: 834, mobile: 390 };

/**
 * The real storefront, framed.
 *
 * This is not a mockup or a thumbnail. It is the merchant's own shop, served
 * from their own subdomain with their own catalogue, rendered through whichever
 * template is being evaluated. They can click a category, open a product, look
 * at the footer — because it is the actual site.
 *
 * How it stays read-only: the template is passed as `?__template=<id>` and an
 * unsaved layout as `?__sections=<encoded>`, both of which the storefront
 * honours for the session and never persists (see the storefront's
 * `middleware.ts`). Nothing here writes; adopting a design and saving a layout
 * are separate, explicit actions.
 *
 * The frame is scaled rather than resized, so "desktop" shows a genuine
 * 1280px layout inside a 700px panel instead of a 700px layout pretending to
 * be one.
 */
export function DevicePreview({
  storefrontUrl,
  templateId,
  customization,
  device,
  onDeviceChange,
  className,
  height = 620,
}: {
  storefrontUrl: string;
  /** Template to preview. Omit to show the store's live design. */
  templateId?: string | null;
  /**
   * An unsaved home-page layout to render. Omit to show what is saved.
   *
   * Pass a value that is already debounced — every change to it reloads the
   * frame, and a merchant typing a heading should not trigger one per keystroke.
   */
  customization?: TemplateCustomization | null;
  device: Device;
  onDeviceChange: (device: Device) => void;
  className?: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set('__template', templateId ?? 'off');

    // A draft that will not fit is dropped rather than truncated: half a layout
    // is a worse answer than the saved one, and the storefront would reject a
    // malformed value anyway.
    const encoded = customization ? encodePreviewCustomization(customization) : null;
    params.set(
      SECTIONS_PARAM,
      encoded && encoded.length <= MAX_ENCODED_LENGTH ? encoded : 'off',
    );

    return `${storefrontUrl}/?${params.toString()}`;
  }, [storefrontUrl, templateId, customization]);

  // Scale the frame to whatever width the panel actually has, so the preview
  // never overflows on a laptop and never letterboxes on a wide monitor.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const available = element.clientWidth;
      setScale(Math.min(1, available / WIDTH[device]));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [device]);

  /**
   * Show the spinner while a new URL loads — but never for long.
   *
   * An iframe that finishes before React attaches its `onLoad` handler (a warm
   * cache, a fast local render) fires the event into nothing, and the overlay
   * would then sit on top of a perfectly good preview forever. The timeout is
   * the backstop: worst case the merchant sees the frame a moment early, which
   * is far better than a permanent spinner over a working store.
   */
  useEffect(() => {
    setLoading(true);
    const settled = setTimeout(() => setLoading(false), 4000);
    return () => clearTimeout(settled);
  }, [url, reloadKey]);

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          value={device}
          onChange={(v) => onDeviceChange(v as Device)}
          options={[
            { value: 'desktop', label: 'Desktop', icon: <Monitor className="h-3.5 w-3.5" /> },
            { value: 'tablet', label: 'Tablet', icon: <Tablet className="h-3.5 w-3.5" /> },
            { value: 'mobile', label: 'Mobile', icon: <Smartphone className="h-3.5 w-3.5" /> },
          ]}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-xs text-content-subtle tabular sm:block">
            {WIDTH[device]}px
          </span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-line p-2 text-content-muted transition hover:bg-surface-muted hover:text-content"
            aria-label="Reload preview"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-content transition hover:bg-surface-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in a tab
          </a>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-line bg-surface-muted"
        style={{ height }}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-surface-muted text-sm text-content-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your store…
          </div>
        )}

        <div
          className="origin-top-left"
          style={{
            width: WIDTH[device],
            // The iframe is rendered at full device height and scaled down, so
            // text inside is genuinely device-sized rather than squashed.
            height: height / scale,
            transform: `scale(${scale})`,
          }}
        >
          <iframe
            key={`${url}-${reloadKey}`}
            src={url}
            title="Storefront preview"
            className="h-full w-full border-0 bg-white"
            onLoad={() => setLoading(false)}
            // The preview is the merchant's own storefront on a sibling
            // subdomain. It needs scripts and same-origin behaviour to be the
            // real thing; it does not need to navigate the console or open
            // pop-ups, so those are withheld.
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    </div>
  );
}
