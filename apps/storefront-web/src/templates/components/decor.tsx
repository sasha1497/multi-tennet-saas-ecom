import { cn } from '@retailos/ui';

/**
 * Decorative motifs that give a template its industry at a glance.
 *
 * Everything here is `aria-hidden` and `pointer-events-none` — it is scenery,
 * not content, and it must never appear in the accessibility tree or intercept
 * a tap. Inline SVG rather than images so the shapes take the template's own
 * colours through `currentColor` and cost no request.
 */

/** One paw print. Four toes and a pad, at whatever size the parent sets. */
export function Paw({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
      <ellipse cx="20" cy="18" rx="7.5" ry="10" />
      <ellipse cx="34" cy="12" rx="7" ry="9.5" />
      <ellipse cx="47" cy="19" rx="7" ry="9" />
      <ellipse cx="55" cy="33" rx="6.5" ry="8" />
      <path d="M33 28c9 0 17 7 17 15 0 6-5 10-11 9-3-.5-4-1.5-6-1.5s-3 1-6 1.5c-6 1-11-3-11-9 0-8 8-15 17-15z" />
    </svg>
  );
}

/**
 * A scattered field of paw prints behind a pet-shop hero.
 *
 * Positions are fixed rather than random: a layout that shifts between the
 * server render and the client one is a hydration mismatch, and a decorative
 * flourish is not worth one. The drift animation is CSS-only and stops dead
 * under `prefers-reduced-motion` (see `globals.css`).
 */
export function PawField({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {PAWS.map((paw, index) => (
        <span
          key={index}
          className="paw-drift absolute block"
          style={{
            left: paw.left,
            top: paw.top,
            width: paw.size,
            height: paw.size,
            opacity: paw.opacity,
            // Each print is rotated and phase-shifted, so the field drifts as a
            // scatter rather than as one block moving in lockstep.
            ['--paw-rotate' as string]: `${paw.rotate}deg`,
            animationDelay: `${paw.delay}s`,
          }}
        >
          <Paw className="h-full w-full" />
        </span>
      ))}
    </span>
  );
}

const PAWS = [
  { left: '4%', top: '18%', size: '38px', rotate: -18, opacity: 0.14, delay: 0 },
  { left: '13%', top: '62%', size: '26px', rotate: 24, opacity: 0.1, delay: 1.4 },
  { left: '26%', top: '8%', size: '30px', rotate: 8, opacity: 0.09, delay: 2.6 },
  { left: '48%', top: '74%', size: '44px', rotate: -32, opacity: 0.08, delay: 0.8 },
  { left: '68%', top: '14%', size: '34px', rotate: 16, opacity: 0.12, delay: 3.1 },
  { left: '82%', top: '58%', size: '28px', rotate: -12, opacity: 0.1, delay: 1.9 },
  { left: '91%', top: '26%', size: '40px', rotate: 30, opacity: 0.07, delay: 2.2 },
];

/**
 * A soft radial glow. Used behind dark technology heroes to suggest a lit
 * stage without needing a photograph the merchant may not have.
 */
export function StageGlow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-1/2 top-0 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/3 rounded-full',
        'bg-[radial-gradient(circle,rgb(var(--color-primary)/0.35),transparent_65%)] blur-2xl',
        className,
      )}
    />
  );
}

/**
 * A fine grid, for technology templates. Masked to fade out towards the edges
 * so it reads as depth rather than as graph paper.
 */
export function GridField({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage:
          'linear-gradient(to right, rgb(255 255 255 / 0.06) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent 100%)',
      }}
    />
  );
}

/**
 * A hairline rule with a centred ornament. The luxury templates' one piece of
 * decoration, standing in for the section borders they deliberately lack.
 */
export function Ornament({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex items-center justify-center gap-3 text-accent', className)}
    >
      <span className="h-px w-12 bg-current opacity-40" />
      <span className="h-1 w-1 rotate-45 bg-current" />
      <span className="h-px w-12 bg-current opacity-40" />
    </span>
  );
}
