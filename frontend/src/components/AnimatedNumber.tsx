import { animate } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@/lib/motion'

/** Плавная смена числа (только отображение). При prefers-reduced-motion значение меняется сразу. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const previous = useRef(value)

  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (reduce || from === value) {
      setShown(value)
      return
    }
    const controls = animate(from, value, { duration: 0.5, ease: [0.2, 0, 0, 1], onUpdate: setShown })
    return () => controls.stop()
  }, [value, reduce])

  return <span className="tabular">{format(shown)}</span>
}
