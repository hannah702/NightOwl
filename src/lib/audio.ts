/**
 * Audio alerting utility using browser Web Audio API.
 * Provides distinct warning chimes for route deviation and emergency alerts.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a calm notification chime
 */
export function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.debug('Audio play failed:', e);
  }
}

/**
 * Plays a clear route deviation alert tone
 */
export function playDeviationAlert() {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
    osc.frequency.setValueAtTime(330, ctx.currentTime + 0.15); // E4
    osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.3); // C#5

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.debug('Deviation audio alert failed:', e);
  }
}

let sirenOsc: OscillatorNode | null = null;
let sirenGain: GainNode | null = null;
let sirenInterval: NodeJS.Timeout | null = null;

/**
 * Starts a loud oscillating emergency deterrence siren
 */
export function startSirenAlert() {
  const ctx = getAudioContext();
  if (!ctx) return;

  stopSirenAlert();

  try {
    sirenOsc = ctx.createOscillator();
    sirenGain = ctx.createGain();

    sirenOsc.type = 'sawtooth';
    sirenOsc.frequency.setValueAtTime(800, ctx.currentTime);

    sirenGain.gain.setValueAtTime(0.4, ctx.currentTime);

    sirenOsc.connect(sirenGain);
    sirenGain.connect(ctx.destination);

    sirenOsc.start();

    let high = true;
    sirenInterval = setInterval(() => {
      if (!ctx || !sirenOsc) return;
      try {
        const targetFreq = high ? 1150 : 750;
        sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, ctx.currentTime + 0.18);
        high = !high;
      } catch {}
    }, 220);
  } catch (e) {
    console.debug('Siren audio failed to start:', e);
  }
}

/**
 * Stops the emergency siren
 */
export function stopSirenAlert() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  if (sirenOsc) {
    try {
      sirenOsc.stop();
      sirenOsc.disconnect();
    } catch {}
    sirenOsc = null;
  }
  if (sirenGain) {
    try {
      sirenGain.disconnect();
    } catch {}
    sirenGain = null;
  }
}
