// Rumore di cabina generato dal vivo con Web Audio: nessun file audio, nessun diritto d'autore.
// Ricetta: fruscio d'aria (rumore rosa) + rombo profondo (rumore marrone) + ronzio dei motori
// + sibilo della ventilazione, con una variazione lentissima come in un volo vero.

let ctx = null;
let master = null;
let built = false;
const VOLUME = 0.9;

// Rumore "rosa": più medi del rumore marrone, quindi si sente anche dagli altoparlanti di un portatile
function pinkNoiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    smoothLoop(data);
  }
  return buffer;
}

// Rumore "marrone": il rombo profondo, per chi usa le cuffie
function brownNoiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    smoothLoop(data);
  }
  return buffer;
}

// Raccordo morbido tra fine e inizio per evitare il "clic" del loop
function smoothLoop(data) {
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const n = data.length;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[n - fade + i] = data[n - fade + i] * (1 - k) + data[i] * k;
  }
}

function loop(buffer, offset = 0) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(0, offset);
  return src;
}

function filter(type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(v) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function build() {
  // Compressore finale: volume pieno senza distorsione
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master = gain(0);
  master.connect(comp).connect(ctx.destination);

  const pink = pinkNoiseBuffer(9);
  const brown = brownNoiseBuffer(7);

  // 1) Il "fruscio" dell'aria sulla fusoliera: la parte che si sente di più
  const air = filter('lowpass', 1600, 0.5);
  loop(pink).connect(filter('highpass', 120)).connect(air).connect(gain(0.75)).connect(master);

  // Variazione lentissima, come le piccole turbolenze
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoDepth = gain(250);
  lfo.connect(lfoDepth).connect(air.frequency);
  lfo.start();

  // 2) Il rombo profondo (si apprezza in cuffia)
  loop(brown, 2).connect(filter('lowpass', 300, 0.5)).connect(gain(0.7)).connect(master);

  // 3) Il ronzio dei motori: toni vicini che "battono", con armoniche udibili anche dal portatile
  const engine = filter('bandpass', 260, 0.9);
  engine.connect(gain(0.05)).connect(master);
  for (const f of [118, 119.4, 236.5]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(engine);
    o.start();
  }

  // 4) Il sibilo leggero della ventilazione
  loop(pink, 4).connect(filter('bandpass', 3200, 0.8)).connect(gain(0.06)).connect(master);

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
