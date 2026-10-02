'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Move3d } from 'lucide-react';
import { cn } from '@retailos/ui';
import type { TurntableHandle } from './scenes';
import { themeColor, useThreeScene } from './use-three-scene';

/**
 * The 3D product viewer: the product's own photographs on a plate the shopper
 * drags to turn.
 *
 * `children` is the ordinary 2D product image and is what the server renders.
 * The turntable takes over the same box once WebGL is confirmed, and follows
 * the gallery thumbnails through `index`. If it cannot run, nothing about the
 * product page changes.
 */
export function Turntable({
  images,
  index,
  aspect,
  enabled,
  children,
}: {
  images: string[];
  index: number;
  /** Width / height of the product image box. */
  aspect: number;
  enabled: boolean;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<TurntableHandle | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const mount = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const { mountTurntable } = await import('./scenes');
      const handle = await mountTurntable(canvas, {
        photos: images.map((url) => ({ url })),
        accent: themeColor('--color-accent', 0x888888),
        aspect,
        initial: indexRef.current,
      });
      handleRef.current = handle;
      return {
        dispose: () => {
          handleRef.current = null;
          handle.dispose();
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images.join('|'), aspect],
  );

  const state = useThreeScene(enabled && images.length > 0, containerRef, canvasRef, mount);
  const live = state === '3d';

  useEffect(() => {
    handleRef.current?.show(index);
  }, [index]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div className={cn('h-full w-full transition-opacity duration-500', live && 'opacity-0')}>{children}</div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn(
          'absolute inset-0 h-full w-full touch-pan-y transition-opacity duration-500',
          live ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      {live && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1.5 text-[11px] text-content-muted backdrop-blur">
          <Move3d className="h-3.5 w-3.5" aria-hidden="true" />
          Drag to turn
        </span>
      )}
    </div>
  );
}
