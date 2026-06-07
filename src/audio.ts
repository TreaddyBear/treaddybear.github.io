import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import mowerUrl from "./assets/lawn-mower.mp3?url";
import breezeDirectionalUrl from "./assets/breeze.mp3?url";
import breezeAmbientUrl from "./assets/breeze-ambient.mp3?url";
import grassCuttingUrl from "./assets/grass-cutting.mp3?url";
import completionFanfareUrl from "./assets/completion-fanfare.mp3?url";
import completionLoopUrl from "./assets/completion-loop.mp3?url";
import flowerPop1Url from "./assets/flower-pop-1.mp3?url";
import flowerPop2Url from "./assets/flower-pop-2.mp3?url";
import flowerPop3Url from "./assets/flower-pop-3.mp3?url";
import flowerPop4Url from "./assets/flower-pop-4.mp3?url";
import flowerPop5Url from "./assets/flower-pop-5.mp3?url";
import flowerPop6Url from "./assets/flower-pop-6.mp3?url";
import flowerPop7Url from "./assets/flower-pop-7.mp3?url";
import wallBumpUrl from "./assets/wall-bump.mp3?url";
import wallBumpSoftUrl from "./assets/wall-bump-soft.mp3?url";
import wallBumpMediumUrl from "./assets/wall-bump-medium.mp3?url";
import wallBumpHardUrl from "./assets/wall-bump-hard.mp3?url";
import reverseBeepUrl from "./assets/reverse-beep.mp3?url";
import gunShotUrl from "./assets/gun-shot.mp3?url";

type AudioSettings = {
  mowerVolume: number;
  breezeVolume: number;
  ambientBreezeVolume: number;
  breezeFacingAmount: number;
  grassCuttingVolume: number;
  grassCuttingAttackDelay: number;
  grassCuttingAttack: number;
  grassCuttingDecay: number;
  flowerPopVolume: number;
  wallBumpVolume: number;
  reverseBeepVolume: number;
  completionFanfareVolume: number;
  completionLoopVolume: number;
  gunShotVolume: number;
};

type LoopWindow = {
  start: number;
  end: number;
};

const flowerPopBank = [
  { sourceUrl: flowerPop1Url, weight: 28 },
  { sourceUrl: flowerPop2Url, weight: 24 },
  { sourceUrl: flowerPop3Url, weight: 20 },
  { sourceUrl: flowerPop4Url, weight: 16 },
  { sourceUrl: flowerPop5Url, weight: 8 },
  { sourceUrl: flowerPop6Url, weight: 3 },
  { sourceUrl: flowerPop7Url, weight: 1 },
];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return AudioContextConstructor ? new AudioContextConstructor() : null;
}

function findLoopWindow(buffer: AudioBuffer): LoopWindow {
  const threshold = 0.0015;
  const maxTrimSamples = Math.floor(buffer.sampleRate * 0.12);
  const firstChannel = buffer.getChannelData(0);
  let startSample = 0;
  let endSample = buffer.length - 1;

  while(startSample < maxTrimSamples && Math.abs(firstChannel[startSample]) < threshold) {
    startSample += 1;
  }

  while(
    endSample > buffer.length - maxTrimSamples
    && endSample > startSample
    && Math.abs(firstChannel[endSample]) < threshold
  ) {
    endSample -= 1;
  }

  return {
    start: startSample / buffer.sampleRate,
    end: Math.max((endSample + 1) / buffer.sampleRate, (startSample + 1) / buffer.sampleRate),
  };
}

async function loadAudioBuffer(sourceUrl: string, audioContext: AudioContext) {
  const response = await fetch(sourceUrl);
  const data = await response.arrayBuffer();

  if(data.byteLength === 0) {
    return null;
  }

  return audioContext.decodeAudioData(data);
}

function createFallbackAudio(sourceUrl: string, loop: boolean) {
  const audio = new Audio(sourceUrl);
  audio.loop = loop;
  audio.preload = "auto";
  audio.volume = 0;
  audio.addEventListener("error", () => {
    audio.volume = 0;
  });
  return audio;
}

function createLoopingTrack(sourceUrl: string) {
  const fallbackAudio = createFallbackAudio(sourceUrl, true);
  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;
  let loading: Promise<void> | null = null;
  let volume = 0;

  const playFallback = () => {
    fallbackAudio.play().catch(() => {
      // Empty placeholder files and autoplay restrictions should not interrupt the prototype.
    });
  };

  const startWebAudio = async () => {
    audioContext ??= getAudioContext();

    if(!audioContext) {
      playFallback();
      return;
    }

    await audioContext.resume();

    if(sourceNode) {
      return;
    }

    const buffer = await loadAudioBuffer(sourceUrl, audioContext);

    if(!buffer) {
      playFallback();
      return;
    }

    const loop = findLoopWindow(buffer);
    gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    gainNode.connect(audioContext.destination);

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = true;
    sourceNode.loopStart = loop.start;
    sourceNode.loopEnd = loop.end;
    sourceNode.connect(gainNode);
    sourceNode.start(0, loop.start);
    fallbackAudio.pause();
  };

  return {
    setVolume(nextVolume: number, response = 0.035) {
      volume = clamp01(nextVolume);
      fallbackAudio.volume = volume;

      if(gainNode && audioContext) {
        gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, Math.max(0.001, response));
      }
    },

    unlock() {
      loading ??= startWebAudio().catch(() => {
        playFallback();
      });
    },
  };
}

function createOneShotTrack(sourceUrl: string) {
  const fallbackAudio = createFallbackAudio(sourceUrl, false);
  let audioContext: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let loading: Promise<AudioBuffer | null> | null = null;

  const load = async () => {
    audioContext ??= getAudioContext();

    if(!audioContext) {
      return null;
    }

    await audioContext.resume();
    buffer = await loadAudioBuffer(sourceUrl, audioContext);
    return buffer;
  };

  const playFallback = (volume: number) => {
    const audio = fallbackAudio.cloneNode(true) as HTMLAudioElement;
    audio.volume = clamp01(volume);
    audio.play().catch(() => {});
  };

  return {
    unlock() {
      loading ??= load().catch(() => null);
    },

    play(volume: number) {
      const safeVolume = clamp01(volume);
      loading ??= load().catch(() => null);
      loading.then((loadedBuffer) => {
        if(!loadedBuffer || !audioContext) {
          playFallback(safeVolume);
          return;
        }

        const gainNode = audioContext.createGain();
        const sourceNode = audioContext.createBufferSource();
        gainNode.gain.value = safeVolume;
        gainNode.connect(audioContext.destination);
        sourceNode.buffer = loadedBuffer;
        sourceNode.connect(gainNode);
        sourceNode.start();
      }).catch(() => {
        playFallback(safeVolume);
      });
    },
  };
}

function chooseWeightedIndex(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;

  for(let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];

    if(roll <= 0) {
      return index;
    }
  }

  return weights.length - 1;
}

export function createPrototypeAudio() {
  const mower = createLoopingTrack(mowerUrl);
  const directionalBreeze = createLoopingTrack(breezeDirectionalUrl);
  const ambientBreeze = createLoopingTrack(breezeAmbientUrl);
  const grassCutting = createLoopingTrack(grassCuttingUrl);
  const reverseBeep = createLoopingTrack(reverseBeepUrl);
  const completionLoop = createLoopingTrack(completionLoopUrl);
  const completionFanfare = createOneShotTrack(completionFanfareUrl);
  const flowerPops = flowerPopBank.map((entry) => createOneShotTrack(entry.sourceUrl));
  const flowerPopWeights = flowerPopBank.map((entry) => entry.weight);
  const wallBump = createOneShotTrack(wallBumpUrl);
  const wallBumpSoft = createOneShotTrack(wallBumpSoftUrl);
  const wallBumpMedium = createOneShotTrack(wallBumpMediumUrl);
  const wallBumpHard = createOneShotTrack(wallBumpHardUrl);
  const gunShot = createOneShotTrack(gunShotUrl);
  let unlocked = false;
  let cuttingActive = false;
  let cuttingStartedAt = 0;
  let reversingActive = false;

  const unlock = () => {
    if(unlocked) {
      return;
    }

    unlocked = true;
    mower.unlock();
    directionalBreeze.unlock();
    ambientBreeze.unlock();
    grassCutting.unlock();
    reverseBeep.unlock();
    completionLoop.unlock();
    completionFanfare.unlock();
    for(const flowerPop of flowerPops) {
      flowerPop.unlock();
    }
    wallBump.unlock();
    wallBumpSoft.unlock();
    wallBumpMedium.unlock();
    wallBumpHard.unlock();
    gunShot.unlock();
  };

  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  return {
    setCuttingActive(active: boolean) {
      if(active && !cuttingActive) {
        cuttingStartedAt = performance.now() / 1000;
      }
      cuttingActive = active;
    },

    setReversingActive(active: boolean) {
      reversingActive = active;
    },

    playFlowerPop(volume: number) {
      flowerPops[chooseWeightedIndex(flowerPopWeights)]?.play(volume);
    },

    playWallBump(volume: number) {
      wallBump.play(volume);
    },

    playFenceBump(volume: number, severity: "soft" | "medium" | "hard") {
      if(severity === "hard") {
        wallBumpHard.play(volume);
      } else if(severity === "medium") {
        wallBumpMedium.play(volume * 0.82);
      } else {
        wallBumpSoft.play(volume * 0.48);
      }
    },

    playGunShot(volume: number) {
      gunShot.play(volume);
    },

    playCompletionFanfare(volume: number) {
      completionFanfare.play(volume);
    },

    setCompletionLoopActive(active: boolean, settings: AudioSettings) {
      completionLoop.setVolume(active ? settings.completionLoopVolume : 0, active ? 0.6 : 0.25);
    },

    update(camera: ArcRotateCamera, settings: AudioSettings) {
      const windDirection = new Vector3(-1, 0, 0);
      const cameraForward = camera.target.subtract(camera.position).normalize();
      const facing = clamp01((Vector3.Dot(cameraForward, windDirection) + 1) / 2);
      const facingVolume = 1 - settings.breezeFacingAmount + (settings.breezeFacingAmount * facing);
      const cuttingAge = (performance.now() / 1000) - cuttingStartedAt;
      const cuttingAudible = cuttingActive && cuttingAge >= settings.grassCuttingAttackDelay;

      mower.setVolume(settings.mowerVolume);
      directionalBreeze.setVolume(settings.breezeVolume * facingVolume);
      ambientBreeze.setVolume(settings.ambientBreezeVolume);
      grassCutting.setVolume(
        cuttingAudible ? settings.grassCuttingVolume : 0,
        cuttingAudible ? settings.grassCuttingAttack : settings.grassCuttingDecay,
      );
      reverseBeep.setVolume(reversingActive ? settings.reverseBeepVolume : 0, reversingActive ? 0.012 : 0.045);

      if(unlocked) {
        mower.unlock();
        directionalBreeze.unlock();
        ambientBreeze.unlock();
        grassCutting.unlock();
        reverseBeep.unlock();
        completionLoop.unlock();
      }
    },
  };
}
