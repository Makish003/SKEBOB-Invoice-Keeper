/**
 * Живые иконки: при наведении мышью, нажатии (и тапе) и фокусе с клавиатуры элемент с классом icon-play
 * получает data-icon-play, и иконка внутри отыгрывает жест из index.css. Атрибут снимается по animationend,
 * поэтому каждое новое касание запускает жест заново. Один обработчик на документ, без состояния в React.
 */
const HOST = '.icon-play'
const ATTR = 'data-icon-play'

function play(host: Element) {
  host.removeAttribute(ATTR)
  void (host as HTMLElement).offsetWidth // перезапуск анимации, если жест ещё идёт
  host.setAttribute(ATTR, '')
}

function hostOf(target: EventTarget | null) {
  return target instanceof Element ? target.closest(HOST) : null
}

export function installIconPlay() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  const onPointerOver = (event: PointerEvent) => {
    if (reduce.matches || event.pointerType !== 'mouse') return
    const host = hostOf(event.target)
    // Только вход в элемент, а не переход между его потомками.
    if (host && !host.contains(event.relatedTarget as Node | null)) play(host)
  }
  const onPointerDown = (event: PointerEvent) => {
    const host = hostOf(event.target)
    if (host && !reduce.matches) play(host)
  }
  const onFocusIn = (event: FocusEvent) => {
    const host = hostOf(event.target)
    if (host && !reduce.matches && host.matches(':focus-visible')) play(host)
  }
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName.startsWith('ik-icon-') || event.animationName === 'ik-key-press') {
      hostOf(event.target)?.removeAttribute(ATTR)
    }
  }

  document.addEventListener('pointerover', onPointerOver)
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('animationend', onAnimationEnd)
}
