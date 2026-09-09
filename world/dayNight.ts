import type { BiomePalette } from './biomes';

export type DayNightMode = 'realtime' | 'cycle';

export interface DayNightConfig {
  mode: DayNightMode;
  /** Real-world minutes used for one complete 24-hour custom cycle. */
  cycleMinutes: number;
  /** Anchor preserves the visible world time when cycle length/mode changes. */
  cycleAnchorMs: number;
  cycleAnchorHour: number;
}

export interface WorldLightingState {
  hour: number;
  daylight: number;
  night: number;
  twilight: number;
  dawn: number;
  dusk: number;
  sunProgress: number;
  moonProgress: number;
}

export const DAY_NIGHT_STORAGE_KEY = 'ai_tag_day_night_v1';
export const MIN_CUSTOM_DAY_MINUTES = 1;
export const MAX_CUSTOM_DAY_MINUTES = 1_440;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const floorMod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export const localHourAt = (nowMs = Date.now()): number => {
  const date = new Date(nowMs);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3_600_000;
};

export const createDefaultDayNightConfig = (nowMs = Date.now()): DayNightConfig => ({
  mode: 'realtime',
  cycleMinutes: 10,
  cycleAnchorMs: nowMs,
  cycleAnchorHour: localHourAt(nowMs),
});

export const sanitizeDayNightConfig = (value: Partial<DayNightConfig> | null | undefined, nowMs = Date.now()): DayNightConfig => {
  const fallback = createDefaultDayNightConfig(nowMs);
  const mode: DayNightMode = value?.mode === 'cycle' ? 'cycle' : 'realtime';
  const cycleMinutes = Number.isFinite(Number(value?.cycleMinutes))
    ? Math.max(MIN_CUSTOM_DAY_MINUTES, Math.min(MAX_CUSTOM_DAY_MINUTES, Number(value?.cycleMinutes)))
    : fallback.cycleMinutes;
  const cycleAnchorMs = Number.isFinite(Number(value?.cycleAnchorMs)) ? Number(value?.cycleAnchorMs) : nowMs;
  const cycleAnchorHour = Number.isFinite(Number(value?.cycleAnchorHour))
    ? floorMod(Number(value?.cycleAnchorHour), 24)
    : localHourAt(nowMs);
  return { mode, cycleMinutes, cycleAnchorMs, cycleAnchorHour };
};

export const resolveWorldHour = (config: DayNightConfig, nowMs = Date.now()): number => {
  if (config.mode === 'realtime') return localHourAt(nowMs);
  const elapsedMinutes = (nowMs - config.cycleAnchorMs) / 60_000;
  return floorMod(config.cycleAnchorHour + (elapsedMinutes / Math.max(MIN_CUSTOM_DAY_MINUTES, config.cycleMinutes)) * 24, 24);
};

export const resolveWorldLighting = (config: DayNightConfig, nowMs = Date.now()): WorldLightingState => {
  const hour = resolveWorldHour(config, nowMs);
  // Long dawn/dusk shoulders deliberately avoid abrupt global lighting changes.
  const sunrise = smoothstep(4.75, 7.0, hour);
  const sunset = 1 - smoothstep(17.75, 20.25, hour);
  const daylight = clamp01(sunrise * sunset);
  const night = 1 - daylight;
  const dawn = clamp01((1 - Math.abs(hour - 6.0) / 2.0) * (hour < 9 ? 1 : 0));
  const dusk = clamp01((1 - Math.abs(hour - 19.0) / 2.25) * (hour > 16 ? 1 : 0));
  const twilight = Math.max(dawn, dusk);
  const sunProgress = clamp01((hour - 5.5) / 14);
  const moonHour = hour >= 18 ? hour - 18 : hour + 6;
  const moonProgress = clamp01(moonHour / 12);
  return { hour, daylight, night, twilight, dawn, dusk, sunProgress, moonProgress };
};

const hexChannel = (value: string, offset: number) => parseInt(value.slice(offset, offset + 2), 16);
const mixHex = (a: string, b: string, amount: number): string => {
  const t = clamp01(amount);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  const channel = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${channel(lerp(hexChannel(a, 1), hexChannel(b, 1)))}${channel(lerp(hexChannel(a, 3), hexChannel(b, 3)))}${channel(lerp(hexChannel(a, 5), hexChannel(b, 5)))}`;
};

const lightColor = (base: string, nightTarget: string, nightAmount: number, warmTarget: string, warmAmount: number, dayLift = 0): string => {
  let result = mixHex(base, '#dbe7e5', dayLift);
  result = mixHex(result, nightTarget, nightAmount);
  return mixHex(result, warmTarget, warmAmount);
};

/** Apply world lighting to scenery/material palettes. Agents remain unmodified for readability. */
export const lightBiomePalette = (palette: BiomePalette, lighting: WorldLightingState): BiomePalette => {
  const night = lighting.night;
  const warm = lighting.twilight;
  const warmSky = lighting.dusk > lighting.dawn ? '#c96757' : '#d98c67';
  const dayLift = lighting.daylight * 0.035;
  return {
    skyTop: lightColor(palette.skyTop, '#030712', night * 0.74, '#4a4666', warm * 0.28, dayLift * 1.4),
    skyBottom: lightColor(palette.skyBottom, '#101626', night * 0.64, warmSky, warm * 0.48, dayLift * 1.7),
    haze: lightColor(palette.haze, '#293344', night * 0.48, '#b97864', warm * 0.24, dayLift),
    far: lightColor(palette.far, '#111827', night * 0.56, '#6d4d52', warm * 0.12, dayLift * 0.5),
    mid: lightColor(palette.mid, '#151d2b', night * 0.47, '#73534f', warm * 0.1, dayLift * 0.55),
    near: lightColor(palette.near, '#192230', night * 0.38, '#77594f', warm * 0.08, dayLift * 0.65),
    detail: lightColor(palette.detail, '#53606d', night * 0.24, '#d49a70', warm * 0.09, dayLift),
    platformTop: lightColor(palette.platformTop, '#273241', night * 0.34, '#8a6758', warm * 0.07, dayLift * 0.6),
    platformFace: lightColor(palette.platformFace, '#202936', night * 0.42, '#76564e', warm * 0.06, dayLift * 0.45),
    platformShadow: lightColor(palette.platformShadow, '#101722', night * 0.48, '#493b3d', warm * 0.04, dayLift * 0.2),
    motionAccent: lightColor(palette.motionAccent, '#70808d', night * 0.12, '#e0a876', warm * 0.08, dayLift),
  };
};

export const formatWorldHour = (hour: number): string => {
  const totalMinutes = Math.round(floorMod(hour, 24) * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
