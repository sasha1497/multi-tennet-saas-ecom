'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  GripVertical,
  ImagePlus,
  RefreshCw,
  Star,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { UploadProgress } from '@retailos/api-client';
import type { ProductImage } from '@retailos/types';
import { Button, cn, useToast } from '@retailos/ui';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

/**
 * One image in the editor.
 *
 * `id` is present only once the row exists in the database. An image that has
 * been uploaded but not yet saved has an `objectKey` and no `id` — which is
 * exactly what distinguishes "delete this from storage on save" from "delete
 * this row through the API right now".
 */
export interface EditorImage {
  id?: string;
  url: string;
  objectKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  alt?: string | null;
}

/** A file still on its way up — or one that failed and can be retried. */
interface PendingUpload {
  key: string;
  file: File;
  percent: number;
  status: UploadProgress['status'];
  error?: string;
}

const MAX_IMAGES = 12;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

export function toEditorImages(images: ProductImage[]): EditorImage[] {
  return images.map((image) => ({
    id: image.id,
    url: image.url,
    objectKey: image.objectKey,
    fileName: image.fileName,
    mimeType: image.mimeType,
    size: image.size,
    alt: image.alt,
  }));
}

/**
 * Multi-image editor for a product.
 *
 * Uploads go **straight from the browser to object storage** using presigned
 * URLs the API issues — the bytes never pass through the console or the API, so
 * a merchant adding eight photos on a phone is not bounded by our request size
 * limit or our bandwidth. See `MerchantResource.uploadFiles`.
 *
 * The state model is what makes the two halves of "editing a gallery" behave
 * sensibly together:
 *
 *  • **Saved images** (they have an `id`) are edited through the API
 *    immediately, because reordering or deleting one is a complete action on
 *    its own and should not wait for the whole product form to be submitted.
 *  • **Newly uploaded images** live in local state until the form is saved,
 *    which is what lets someone add a photo to a product they are still
 *    creating, and lets them change their mind before committing.
 *
 * `onChange` reports the full ordered list either way, so the form always sends
 * a gallery that matches what is on screen.
 */
export function ProductImageEditor({
  images,
  onChange,
  productId,
  disabled,
}: {
  images: EditorImage[];
  onChange: (images: EditorImage[]) => void;
  /** Present when editing. Scopes uploaded keys to this product. */
  productId?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const showError = useErrorToast();

  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Uploads outlive a re-render but must not outlive the component: an
  // in-flight PUT that resolves after unmount would call setState on a dead
  // tree, and its progress events are worth nothing to anyone by then.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const remaining =
    MAX_IMAGES - images.length - pending.filter((p) => p.status !== 'failed').length;

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      if (files.length > remaining) {
        toast.error(
          'Too many images',
          `A product can have ${MAX_IMAGES}. There is room for ${Math.max(0, remaining)} more.`,
        );
        return;
      }

      const batch: PendingUpload[] = files.map((file) => ({
        key: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        percent: 0,
        status: 'pending' as const,
      }));
      setPending((list) => [...list.filter((p) => p.status !== 'failed'), ...batch]);

      abort.current = new AbortController();

      try {
        const { uploaded, failed } = await api().merchant.uploadFiles(files, {
          folder: 'products',
          productId,
          signal: abort.current.signal,
          onProgress: (progress) => {
            setPending((list) =>
              list.map((item) =>
                item.key === batch[progress.index]?.key
                  ? {
                      ...item,
                      percent: progress.percent,
                      status: progress.status,
                      error: progress.error,
                    }
                  : item,
              ),
            );
          },
        });

        if (uploaded.length > 0) {
          onChange([
            ...images,
            ...uploaded.map((file) => ({
              url: file.url,
              objectKey: file.objectKey,
              fileName: file.fileName,
              mimeType: file.mimeType,
              size: file.size,
            })),
          ]);
        }

        // Successful uploads leave the pending list; failures stay put so the
        // merchant can see which ones went wrong and retry just those.
        const failedKeys = new Set(failed.map((f) => batch[f.index]?.key));
        setPending((list) => list.filter((item) => failedKeys.has(item.key)));

        if (failed.length > 0) {
          toast.error(
            failed.length === 1 ? 'One image failed' : `${failed.length} images failed`,
            'Use the retry button on each to try again.',
          );
        }
      } catch (err) {
        setPending((list) =>
          list.map((item) =>
            batch.some((b) => b.key === item.key)
              ? { ...item, status: 'failed' as const, error: 'Upload failed' }
              : item,
          ),
        );
        showError(err, 'Could not upload these images');
      }
    },
    [images, onChange, productId, remaining, showError, toast],
  );

  const retry = (item: PendingUpload) => {
    setPending((list) => list.filter((p) => p.key !== item.key));
    void upload([item.file]);
  };

  /**
   * Removes an image.
   *
   * A saved image goes through the API, which deletes the object as well — the
   * merchant asked for it to be gone, and leaving the file in the bucket would
   * make "delete" quietly mean "hide". An unsaved one is only local state.
   */
  const remove = async (index: number) => {
    const image = images[index];
    const next = images.filter((_, i) => i !== index);

    if (image.id && productId) {
      try {
        await api().merchant.deleteProductImage(productId, image.id);
      } catch (err) {
        showError(err, 'Could not delete this image');
        return;
      }
    }
    onChange(next);
  };

  const setPrimary = (index: number) => {
    if (index === 0) return;
    const next = [...images];
    const [chosen] = next.splice(index, 1);
    onChange([chosen, ...next]);
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div>
      {/* ── Drop zone ─────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          const files = [...e.dataTransfer.files].filter((f) => ACCEPT.includes(f.type));
          if (files.length < e.dataTransfer.files.length) {
            toast.error('Some files were skipped', 'Only JPEG, PNG, WebP and AVIF are accepted.');
          }
          void upload(files);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-line',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloud
          className={cn('mx-auto h-8 w-8', dragOver ? 'text-primary' : 'text-content-subtle')}
          aria-hidden="true"
        />
        <p className="mt-2 text-sm font-medium text-content">
          Drop images here, or{' '}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-content-subtle">
          JPEG, PNG, WebP or AVIF · up to 5 MB each · {Math.max(0, remaining)} of {MAX_IMAGES}{' '}
          remaining
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            // Reset so re-picking the same file fires `change` again.
            e.target.value = '';
          }}
        />
      </div>

      {/* ── In-flight and failed uploads ──────────────────────────────── */}
      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-content">{item.file.name}</p>
                {item.status === 'failed' ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-danger-600">
                    <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {item.error ?? 'Upload failed'}
                  </p>
                ) : (
                  <div
                    className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted"
                    role="progressbar"
                    aria-valuenow={item.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${item.file.name}`}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                )}
              </div>

              {item.status === 'failed' ? (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<RefreshCw className="h-3 w-3" />}
                  onClick={() => retry(item)}
                >
                  Retry
                </Button>
              ) : (
                <span className="tabular shrink-0 text-[11px] text-content-muted">
                  {item.status === 'confirming' ? 'Verifying…' : `${item.percent}%`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── The gallery ───────────────────────────────────────────────── */}
      {images.length > 0 && (
        <>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <li
                key={image.id ?? image.objectKey ?? image.url}
                draggable={!disabled}
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) move(dragIndex, index);
                  setDragIndex(null);
                }}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-line bg-surface',
                  dragIndex === index && 'opacity-40',
                )}
              >
                <img
                  src={image.url}
                  alt={image.alt ?? ''}
                  className="aspect-square w-full object-cover"
                />

                {index === 0 && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                    <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                    Main
                  </span>
                )}

                <span
                  className="absolute right-2 top-2 cursor-grab rounded-md bg-neutral-900/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>

                <div className="flex items-center justify-between gap-1 border-t border-line p-1.5">
                  <button
                    type="button"
                    onClick={() => setPrimary(index)}
                    disabled={index === 0 || disabled}
                    className="rounded px-1.5 py-1 text-[11px] font-medium text-content-muted hover:text-primary disabled:opacity-40"
                  >
                    {index === 0 ? 'Main image' : 'Make main'}
                  </button>

                  <span className="flex items-center">
                    {/* Keyboard-reachable reordering: drag and drop alone would
                        make ordering impossible without a mouse. */}
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0 || disabled}
                      aria-label="Move image earlier"
                      className="rounded px-1 py-1 text-xs text-content-muted hover:text-content disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={index === images.length - 1 || disabled}
                      aria-label="Move image later"
                      className="rounded px-1 py-1 text-xs text-content-muted hover:text-content disabled:opacity-30"
                    >
                      →
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(index)}
                      disabled={disabled}
                      aria-label={`Delete ${image.fileName ?? 'image'}`}
                      className="rounded px-1 py-1 text-danger-600 hover:bg-danger-50 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-2.5 text-xs text-content-subtle">
            Drag to reorder, or use the arrows. The first image is shown on product cards and search
            results.
          </p>
        </>
      )}

      {images.length === 0 && pending.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-content-subtle">
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          No images yet. Products with photos sell considerably better.
        </p>
      )}
    </div>
  );
}
