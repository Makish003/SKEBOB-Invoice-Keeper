/**
 * Звук механической клавиши для знака-логотипа, синтез через Web Audio (без аудиофайлов).
 * Нажатие: щелчок переключателя (короткий шум в высокой полосе) + «тук» клавиши о дно (низкий затухающий тон).
 * Отпускание: тихий щелчок возврата. AudioContext создаётся при первом нажатии: браузер разрешает звук
 * только после жеста пользователя.
 */
let context: AudioContext | undefined
let noise: AudioBuffer | undefined

function audio() {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

function noiseBuffer(ctx: BaseAudioContext) {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.06), ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noise
}

interface Hit {
  at: number
  freq: number
  gain: number
  decay: number
}

/** Щелчок: шум через полосовой фильтр с резким затуханием. */
function click(ctx: BaseAudioContext, { at, freq, gain, decay }: Hit) {
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = 1.4
  const env = ctx.createGain()
  env.gain.setValueAtTime(gain, at)
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  source.connect(band).connect(env).connect(ctx.destination)
  source.start(at)
  source.stop(at + decay)
}

/** «Тук»: низкий тон с лёгким падением высоты, как корпус клавиши о пластину. */
function thock(ctx: BaseAudioContext, { at, freq, gain, decay }: Hit) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, at)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + decay)
  const env = ctx.createGain()
  env.gain.setValueAtTime(gain, at)
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(env).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + decay)
}

export function keyDownSound(ctx: BaseAudioContext = audio()) {
  const t = ctx.currentTime
  click(ctx, { at: t, freq: 3800, gain: 0.5, decay: 0.018 })
  click(ctx, { at: t + 0.006, freq: 1200, gain: 0.3, decay: 0.035 })
  thock(ctx, { at: t + 0.008, freq: 190, gain: 0.45, decay: 0.07 })
}

export function keyUpSound(ctx: BaseAudioContext = audio()) {
  const t = ctx.currentTime
  click(ctx, { at: t, freq: 3000, gain: 0.18, decay: 0.015 })
  thock(ctx, { at: t + 0.004, freq: 260, gain: 0.15, decay: 0.035 })
}
