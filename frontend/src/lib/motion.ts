/**
 * Общие пресеты анимаций (motion/react). Только transform/opacity (ADR-013).
 * При prefers-reduced-motion компоненты используют `useReducedMotion()` и отключают смещения.
 */
import type { Transition, Variants } from 'motion/react'

export { useReducedMotion } from 'motion/react'

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30 }

export const easeOut: Transition = { duration: 0.2, ease: [0.2, 0, 0, 1] }

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: easeOut },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: easeOut },
}

export const stagger = (step = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step } },
})

/** Варианты без смещения: для prefers-reduced-motion. */
export const reduced: Variants = {
  hidden: { opacity: 1 },
  show: { opacity: 1 },
}
