// Rumore di cabina generato dal vivo con Web Audio: nessun file audio, nessun diritto d'autore.
// Ricetta: rombo d'aria (rumore "marrone" filtrato) + fruscio leggero + ronzio dei motori
// con un battimento lento, e una variazione lentissima come in un volo vero.

let ctx = null;
let master = null;
let built = false;
const VOLUME = 0.55;

function brownNoiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // Raccordo morbido tra fine e inizio per evitare il "clic" del loop
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[length - fade + i] = data[length - fade + i] * (1 - k) + data[i] * k;
    }
  }
  return buffer;
}

function build() {
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const noise = brownNoiseBuffer(9);

  // Rombo dell'aria sulla fusoliera
  const roar = ctx.createBufferSource();
  roar.buffer = noise;
  roar.loop = true;
  const roarFilter = ctx.createBiquadFilter();
  roarFilter.type = 'lowpass';
  roarFilter.frequency.value = 420;
  roarFilter.Q.value = 0.5;
  const roarGain = ctx.createGain();
  roarGain.gain.value = 0.9;
  roar.connect(roarFilter).connect(roarGain).connect(master);

  // Variazione lentissima del rombo
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 70;
  lfo.connect(lfoDepth).connect(roarFilter.frequency);

  // Fruscio dell'aria condizionata
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;
  hiss.loopStart = 3;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'bandpass';
  hissFilter.frequency.value = 1400;
  hissFilter.Q.value = 0.6;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.05;
  hiss.connect(hissFilter).connect(hissGain).connect(master);

  // Ronzio dei motori: due toni vicini che "battono" lentamente
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 260;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0.035;
  engineFilter.connect(engineGain).connect(master);
  for (const f of [88, 89.3]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(engineFilter);
    o.start();
  }

  roar.start();
  hiss.start(0, 3);
  lfo.start();
  built = true;
}

/** Avvia il rumore di cabina. Va chiamata dopo un clic (regola dei browser). */
export function startCabin() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!built) build();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.9);
  } catch {
    // Audio non disponibile: l'app continua senza suono
  }
}

/** Spegne il rumore con una dissolvenza breve. */
export function stopCabin() {
  if (!ctx || !master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
}

/** Sospende l'audio quando la scheda non è visibile, per non consumare batteria. */
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});
