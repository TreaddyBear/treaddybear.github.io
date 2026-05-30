import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import mowerUrl from "./assets/lawn-mower.mp3?url";
import breezeUrl from "./assets/breeze.mp3?url";

type AudioSettings = {
  mowerVolume: number;
  breezeVolume: number;
  breezeFacingAmount: number;
};

type LoopWindow = {
  start: number;
  end: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function findLoopWindow(buffer: AudioBuffer): LoopWindow {
  const threshold = 0.0015;
  const maxTrimSamples = Math.floor(buffer.sampleRate * 0.12);
  const firstChannel = buffer.getChannelData(0);
  let startSample = 0;
  let endSample = buffer.length - 1;

  while (startSample < maxTrimSamples && Math.abs(firstChannel[startSample]) < threshold) {
    startSample += 1;
  }

  while (
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

function createFallbackAudio(src: string) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  audio.addEventListener("error", () => {
    audio.volume = 0;
  });
  return audio;
}

function createLoopingTrack(src: string) {
  const fallbackAudio = createFallbackAudio(src);
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
    const Context = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Context) {
      playFallback();
      return;
    }

    audioContext ??= new Context();
    await audioContext.resume();

    if (sourceNode) {
      return;
    }

    const response = await fetch(src);
    const data = await response.arrayBuffer();

    if (data.byteLength === 0) {
      playFallback();
      return;
    }

    const buffer = await audioContext.decodeAudioData(data);
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
    setVolume(nextVolume: number) {
      volume = clamp01(nextVolume);
      fallbackAudio.volume = volume;

      if (gainNode && audioContext) {
        gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.035);
      }
    },

    unlock() {
      loading ??= startWebAudio().catch(() => {
        playFallback();
      });
    },
  };
}

export function createPrototypeAudio() {
  const mower = createLoopingTrack(mowerUrl);
  const breeze = createLoopingTrack(breezeUrl);
  let unlocked = false;

  const unlock = () => {
    if (unlocked) {
      return;
    }

    unlocked = true;
    mower.unlock();
    breeze.unlock();
  };

  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  return {
    update(camera: ArcRotateCamera, settings: AudioSettings) {
      const windDirection = new Vector3(1, 0, 0);
      const cameraForward = camera.target.subtract(camera.position).normalize();
      const facing = clamp01((Vector3.Dot(cameraForward, windDirection) + 1) / 2);
      const facingVolume = 1 - settings.breezeFacingAmount + (settings.breezeFacingAmount * facing);

      mower.setVolume(settings.mowerVolume);
      breeze.setVolume(settings.breezeVolume * facingVolume);

      if (unlocked) {
        mower.unlock();
        breeze.unlock();
      }
    },
  };
}
