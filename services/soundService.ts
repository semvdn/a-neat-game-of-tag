
import { JUMP_STRENGTH } from '../constants';

let audioContext: AudioContext | null = null;
let isAudioInitialized = false;

// Call this on the first user interaction to enable audio
export const initAudio = () => {
    if (isAudioInitialized || typeof window === 'undefined') return;
    try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        isAudioInitialized = true;
    } catch (e) {
        console.error("Web Audio API is not supported in this browser");
    }
};

const playNote = (frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', rampDown: boolean = true) => {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    if (rampDown) {
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    }

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
};

export const playDynamicJumpSound = (jumpVelocityY: number) => {
    const minFreq = 480; // B4
    const maxFreq = 640; // E5
    const absVelocity = Math.abs(jumpVelocityY);
    const jumpMagnitude = Math.abs(JUMP_STRENGTH);
    const ratio = Math.min(1, Math.max(0, absVelocity / (jumpMagnitude || 1)));

    const baseFrequency = minFreq + (maxFreq - minFreq) * ratio;
    const duration = 0.12;
    const volume = 0.06;

    playNote(baseFrequency, duration, volume, 'sine');
    playNote(baseFrequency * 1.5, duration, volume * 0.6, 'sine');
};

export const playTagSound = () => {
    playNote(1200, 0.05, 0.15, 'square');
    playNote(800, 0.1, 0.15, 'square');
};

export const playFallSound = () => {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.linearRampToValueAtTime(0.001, now + 0.4);
    gainNode.connect(audioContext.destination);

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(300, now);
    oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.4);
    oscillator.connect(gainNode);

    oscillator.start(now);
    oscillator.stop(now + 0.4);
};

export const playToggleSound = (isOn: boolean) => {
    if (isOn) {
        playNote(800, 0.1, 0.08, 'triangle');
    } else {
        playNote(600, 0.1, 0.08, 'triangle');
    }
};
