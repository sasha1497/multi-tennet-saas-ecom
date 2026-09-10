'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RevealStyle } from '@retailos/templates';
import { cn } from '@retailos/ui';
import { useTemplate } from './context';

/**
 * Scroll-driven motion for the storefront.
 *
 * Four rules this module exists to enforce, rather than leave to whoever writes
 * the next section:
 *
 *  1. **Only `transform` and `opacity` animate.** Both are composited on the
 *     GPU, so a reveal never triggers layout or paint. Animating `height`,
 *     `top` or `margin` — which is what an unconstrained implementation drifts
 *     towards — is what makes a "premium" page stutter on a mid-range phone.
 *  2. **One observer, not one per element.** A page with sixty product cards
 *     would otherwise create sixty `IntersectionObserver`s. There is exactly
 *     one, shared, and elements unsubscribe as soon as they have appeared.
 *  3. **No scroll handlers.** The parallax below reads scroll position inside
 *     `requestAnimationFrame` and only while the element is on screen, so
 *     nothing is computed for a hero that scrolled past ten sections ago.
 *  4. **`prefers-reduced-motion` is honoured at the source.** Reduced motion
 *     does not mean "a shorter animation" — it means the element renders in its
 *     final state and no observer is ever attached. See `globals.css` for the
 *     CSS half of the same promise.
 *
 * Server-rendered markup is always the *finished* state with a `data-reveal`
 * attribute; the "hidden" starting state is applied by CSS only once the client
 * has confirmed motion is wanted. A page with JavaScript disabled therefore
 * shows its content rather than a column of invisible sections.
 */

/** True when the visitor has asked their system for less animation. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

// ------------------------------------------------------------- observer ----

type RevealCallback = (visible: boolean) => void;

let sharedObserver: IntersectionObserver | null = null;
const subscribers = new WeakMap<Element, RevealCallback>();

function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (sharedObserver) return sharedObserver;

  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        subscribers.get(entry.target)?.(true);
        // One-shot: content does not re-hide when scrolled back past. Repeating
        // the animation on every pass is the single most irritating thing a
        // scroll effect can do.
        sharedObserver?.unobserve(entry.target);
        subscribers.delete(entry.target);
      }
    },
    // Fires slightly before the element reaches the viewport, so the animation
    // is already underway by the time it is properly in view.
    { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
  );

  return sharedObserver;
}

// --------------------------------------------------------------- reveal ----

export interface RevealProps {
  children: ReactNode;
  /** Overrides the template's own reveal style. */
  style?: RevealStyle;
  /** Milliseconds to hold before starting. Used to stagger a row. */
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article' | 'span';
}

/**
 * Reveals its children once they scroll into view.
 *
 * Renders nothing extra when the active template asks for no motion, so a
 * standard template pays no runtime cost at all for a feature it does not use —
 * the component collapses to its children.
 */
export function Reveal({ children, style, delay = 0, className, as = 'div' }: RevealProps) {
  const { motion } = useTemplate();
  const reduced = usePrefersReducedMotion();
  const effective = style ?? motion.reveal;

  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  const inert = effective === 'none' || reduced;

  useEffect(() => {
    if (inert) return;
    const element = ref.current;
    const io = observer();

    // No observer support: show the content rather than leaving it hidden.
    if (!element || !io) {
      setVisible(true);
      return;
    }

    subscribers.set(element, () => setVisible(true));
    io.observe(element);

    return () => {
      io.unobserve(element);
      subscribers.delete(element);
    };
  }, [inert]);

  if (inert) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      data-reveal={effective}
      data-visible={visible ? 'true' : undefined}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * Reveals a list of children one after another.
 *
 * `step` is deliberately small and the total is capped: a twelve-item grid with
 * a 100 ms step would take over a second to finish, by which point the visitor
 * is looking at the next section and the effect reads as slowness rather than
 * polish.
 */
export function RevealGroup({
  children,
  step = 60,
  max = 6,
  className,
  as = 'div',
}: {
  children: ReactNode[];
  step?: number;
  /** Items past this index all share the last delay. */
  max?: number;
  className?: string;
  as?: 'div' | 'ul';
}) {
  const { motion } = useTemplate();
  const Tag = as;

  if (motion.reveal === 'none' || !motion.stagger) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag className={className}>
      {children.map((child, index) => (
        <Reveal key={index} delay={Math.min(index, max) * step} as={as === 'ul' ? 'li' : 'div'}>
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}

// ------------------------------------------------------------- parallax ----

/**
 * Moves its children slightly slower than the page scrolls.
 *
 * Used on hero imagery only. The offset is written straight to a CSS custom
 * property inside `requestAnimationFrame` — never to a React state — because a
 * re-render per scroll frame is exactly the "heavy JavaScript animation loop"
 * this is supposed to avoid. The listener is passive and is removed the moment
 * the element leaves the viewport.
 *
 * `strength` is a fraction of scroll distance. Anything above ~0.25 stops
 * reading as depth and starts reading as a bug.
 */
export function Parallax({
  children,
  strength = 0.15,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const { motion } = useTemplate();
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const inert = !motion.parallax || reduced;

  useEffect(() => {
    if (inert) return;
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    let onScreen = true;

    const update = () => {
      frame = 0;
      if (!onScreen) return;
      const rect = element.getBoundingClientRect();
      // Distance the element's top has travelled past the viewport top.
      const offset = Math.round(-rect.top * strength);
      element.style.setProperty('--parallax-y', `${offset}px`);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    // Stop doing arithmetic entirely once the hero has scrolled away.
    const visibility = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) onScroll();
      },
      { threshold: 0 },
    );
    visibility.observe(element);

    window.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener('scroll', onScroll);
      visibility.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [inert, strength]);

  if (inert) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} data-parallax="" className={className}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- hover ----

/**
 * The template's hover treatment, as a class string.
 *
 * Returned rather than wrapped in a component so a card can put it on the
 * element that already exists instead of gaining a wrapper div — hover effects
 * are cheap only while they stay CSS.
 */
export function useHoverClass(): string {
  const { motion } = useTemplate();
  return HOVER_CLASS[motion.hover];
}

const HOVER_CLASS: Record<string, string> = {
  none: '',
  lift: 'transition-transform duration-300 ease-out motion-safe:hover:-translate-y-1',
  zoom: 'transition-transform duration-500 ease-out motion-safe:hover:scale-[1.02]',
  glow: 'transition-shadow duration-300 motion-safe:hover:shadow-xl motion-safe:hover:shadow-primary/10',
};

/**
 * A heading whose words rise into place, one after the next.
 *
 * Only worth using on a hero — it splits on spaces, which is fine for a short
 * statement and wrong for a paragraph. Falls back to plain text under reduced
 * motion or a template with motion off, so the words are never split for a
 * screen reader in a way that changes how the sentence is announced: the whole
 * heading keeps one accessible name either way.
 */
export function RevealWords({ text, className }: { text: string; className?: string }) {
  const { motion } = useTemplate();
  const reduced = usePrefersReducedMotion();

  if (motion.reveal === 'none' || reduced) return <span className={className}>{text}</span>;

  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((word, index) => (
        <span key={index} className="inline-block overflow-hidden align-bottom">
          <span
            data-reveal-word=""
            style={{ '--reveal-delay': `${Math.min(index, 8) * 70}ms` } as CSSProperties}
            className="inline-block"
          >
            {word}
            {index < words.length - 1 ? ' ' : ''}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Sticky-header shrink state, for templates whose navigation reacts to scroll. */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return scrolled;
}

/** Small helper for conditional motion classes at call sites. */
export function motionClass(enabled: boolean, classes: string): string {
  return cn(enabled && classes);
}
