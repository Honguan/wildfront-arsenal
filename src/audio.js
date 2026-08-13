let context;
let buses;
let music;
let settings = { master: 80, music: 55, sfx: 80, ui: 70 };

export function musicMix(intensity, danger = 'combat') {
  const level = Math.max(0, Math.min(1, intensity));
  return {
    exploration: danger === 'exploration' ? .8 : Math.max(0, .5 - level),
    combat: danger === 'boss' ? .9 : level * .7,
    pulse: danger === 'boss' ? 172 : 88 + level * 84,
  };
}

function createBus(gain) {
  const node = context.createGain();
  node.gain.value = gain;
  return node;
}

export function initAudio() {
  context ??= new AudioContext();
  context.resume();
  if (buses) return;
  const compressor = context.createDynamicsCompressor();
  buses = { master: createBus(1), music: createBus(1), sfx: createBus(1), ui: createBus(1) };
  buses.music.connect(buses.master);
  buses.sfx.connect(buses.master);
  buses.ui.connect(buses.master);
  buses.master.connect(compressor);
  compressor.connect(context.destination);
  const exploration = createBus(0);
  const combat = createBus(0);
  const ambient = createBus(0);
  const bass = context.createOscillator();
  const pulse = context.createOscillator();
  const wind = context.createOscillator();
  bass.type = 'triangle';
  bass.frequency.value = 48;
  pulse.type = 'sine';
  wind.type = 'triangle';
  pulse.frequency.value = 96;
  wind.frequency.value = 32;
  bass.connect(exploration);
  pulse.connect(combat);
  wind.connect(ambient);
  exploration.connect(buses.music);
  combat.connect(buses.music);
  ambient.connect(buses.sfx);
  bass.start();
  pulse.start();
  wind.start();
  music = { exploration, combat, ambient, bass, pulse, wind };
  setAudioSettings(settings);
}

export function setAudioSettings(next) {
  settings = { ...settings, ...next };
  if (!context || !buses) return;
  const now = context.currentTime;
  buses.master.gain.setTargetAtTime(settings.master / 100, now, .03);
  buses.music.gain.setTargetAtTime(settings.music / 100, now, .03);
  buses.sfx.gain.setTargetAtTime(settings.sfx / 100, now, .03);
  buses.ui.gain.setTargetAtTime(settings.ui / 100, now, .03);
}

function tone(frequency, duration, gain, type = 'sine', destination = 'sfx', delay = 0) {
  if (!context || !buses) return;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const now = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, frequency), now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * .35), now + duration);
  envelope.gain.setValueAtTime(gain, now);
  envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
  oscillator.connect(envelope);
  envelope.connect(buses[destination]);
  oscillator.start(now);
  oscillator.stop(now + duration + .01);
}

export function playShot(name, environment = 'outdoor') {
  const hash = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  tone(105 + hash % 190, .075, .075, hash % 2 ? 'sawtooth' : 'square');
  tone(780 + hash % 420, .025, .022, 'square', 'sfx', .006);
  tone(environment === 'indoor' ? 115 : 72, environment === 'indoor' ? .18 : .28, .026, 'triangle', 'sfx', .025);
}

export function playImpact() { tone(58, .12, .045); }
export function playHealthCue() { tone(52, .12, .025, 'sine'); tone(46, .12, .018, 'sine', 'sfx', .16); }
export function playHeadshot() { tone(980, .055, .025, 'triangle', 'ui'); tone(1480, .04, .016, 'sine', 'ui', .04); }
export function playReload() { tone(520, .045, .025, 'square'); tone(310, .08, .02, 'triangle', 'sfx', .08); }
export function playEquip() { tone(260, .07, .025, 'triangle', 'ui'); }
export function playEmpty() { tone(920, .025, .018, 'square'); }
export function playDanger(kind = 'elite') {
  const bossTone = { juggernaut: 42, 'hunter-alpha': 68, 'drone-carrier': 84, 'siege-walker': 36, phantom: 112 }[kind];
  tone(bossTone ?? (kind === 'boss' ? 46 : 92), .45, .055, 'sawtooth');
}

export function environmentMix(map, weather, time) {
  const frequency = { verdant: 38, iron: 54, prism: 72 }[map] ?? 42;
  const weatherGain = { rain: .007, 'heavy-rain': .011, storm: .014, fog: .004, sandstorm: .012, blizzard: .012 }[weather] ?? .0025;
  return { frequency: frequency * (time === 'night' ? .8 : 1), gain: weatherGain };
}

export function setEnvironmentAudio(map, weather, time) {
  if (!music || !context) return;
  const mix = environmentMix(map, weather, time);
  music.wind.frequency.setTargetAtTime(mix.frequency, context.currentTime, .4);
  music.ambient.gain.setTargetAtTime(mix.gain, context.currentTime, .5);
}

export function playWeather(kind) {
  if (kind === 'storm') { tone(34, .55, .045, 'sawtooth'); tone(68, .22, .02, 'triangle', 'sfx', .08); }
}

export function setMusicIntensity(value, danger = 'combat') {
  if (!music || !context) return;
  const mix = musicMix(value, danger);
  const now = context.currentTime;
  music.exploration.gain.setTargetAtTime(.018 * mix.exploration, now, .4);
  music.combat.gain.setTargetAtTime(.03 * mix.combat, now, .35);
  music.pulse.frequency.setTargetAtTime(mix.pulse, now, .35);
}
