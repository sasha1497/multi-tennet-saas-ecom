'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * The 3D layer's entry rules, in one place.
 *
 * A 3D variant always server-renders a complete 2D composition. This hook
 * decides whether to *upgrade* it, and only does so when every one of these
 * holds:
 *
 *   • the store is entitled to the 3D family (or the merchant is previewing)
 *   • the browser can create a WebGL context
 *   • the visitor has not asked for reduced motion or reduced data
 *   • the device is not a phone-sized screen, and reports enough memory and
 *     cores where it reports them at all
 *   • the island has scrolled near the viewport, and the main thread is idle
 *
 * three.js is then fetched with a dynamic import — a separate chunk that a 2D
 * visitor never downloads. If anything throws on the way (no WebGL after all,
 * a texture blocked by CORS, a lost context), the island stays 2D. A shop must
 * never be worse off for having chosen a 3D template.
 */

export type SceneHandle = { dispose: () => void };
export type SceneMount = (canvas: HTMLCanvasElement) => Promise<SceneHandle>;
export type ThreeState = '2d' | 'loading' | '3d';

export function canRun3D(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  // Phones get the 2D composition: a drag-to-spin surface competes with page
  // scrolling under a thumb, and the battery cost is not worth it there.
  if (window.matchMedia('(max-width: 767px)').matches) return false;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.connection?.saveData) return false;
  if (nav.connection?.effectiveType && /(^|-)2g$/.test(nav.connection.effectiveType)) return false;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return false;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return false;

  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return false;
    // Release the probe context straight away; browsers cap live contexts.
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mounts a scene into `canvasRef` once the rules above allow it.
 *
 * `mount` must be stable for the island's lifetime (define it with
 * `useCallback`, or outside the component); a new identity remounts the scene.
 */
export function useThreeScene(
  enabled: boolean,
  containerRef: RefObject<HTMLElement>,
  canvasRef: RefObject<HTMLCanvasElement>,
  mount: SceneMount,
): ThreeState {
  const [state, setState] = useState<ThreeState>('2d');

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !container || !canvas || !canRun3D()) return;

    let handle: SceneHandle | null = null;
    let cancelled = false;
    let idleId: number | null = null;

    const start = async () => {
      setState('loading');
      try {
        const scene = await mount(canvas);
        if (cancelled) {
          scene.dispose();
          return;
        }
        handle = scene;
        setState('3d');
      } catch {
        if (!cancelled) setState('2d');
      }
    };

    const schedule = () => {
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (w.requestIdleCallback) {
        idleId = w.requestIdleCallback(() => void start(), { timeout: 1500 });
      } else {
        idleId = window.setTimeout(() => void start(), 250);
      }
    };

    // Wait until the island is near the viewport: a 3D section further down
    // the page should not cost anything for a visitor who never reaches it.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          schedule();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(container);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      handle?.dispose();
      handle = null;
      setState('2d');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      cancelled = true;
      io.disconnect();
      if (idleId !== null) {
        const w = window as Window & { cancelIdleCallback?: (id: number) => void };
        if (w.cancelIdleCallback) w.cancelIdleCallback(idleId);
        else window.clearTimeout(idleId);
      }
      canvas.removeEventListener('webglcontextlost', onContextLost);
      handle?.dispose();
      handle = null;
    };
  }, [enabled, containerRef, canvasRef, mount]);

  return state;
}

/** Reads a theme colour custom property (`"r g b"` channels) as a hex number. */
export function themeColor(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  return (parts[0]! << 16) | (parts[1]! << 8) | parts[2]!;
}
