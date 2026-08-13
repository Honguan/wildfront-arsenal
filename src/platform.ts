import type { WebGLRenderer } from 'three';

export type GraphicsProfile = 'low' | 'medium' | 'high' | 'ultra';

export const GRAPHICS_PROFILES = {
  low: { drawDistance: 70, particles: 120, resolutionScale: .75, shadows: false },
  medium: { drawDistance: 100, particles: 220, resolutionScale: 1, shadows: true },
  high: { drawDistance: 120, particles: 300, resolutionScale: 1.25, shadows: true },
  ultra: { drawDistance: 140, particles: 300, resolutionScale: 1.5, shadows: true },
} satisfies Record<GraphicsProfile, { drawDistance: number; particles: number; resolutionScale: number; shadows: boolean }>;

export interface HardwareCapabilities {
  deviceMemory: number;
  maxTextureSize: number;
  profile: Exclude<GraphicsProfile, 'ultra'>;
  webgl2: boolean;
  webgpu: boolean;
}

export function detectGraphicsProfile(renderer: WebGLRenderer): HardwareCapabilities {
  const hardwareNavigator = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const deviceMemory = hardwareNavigator.deviceMemory ?? 4;
  const maxTextureSize = renderer.capabilities.maxTextureSize;
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && renderer.getContext() instanceof WebGL2RenderingContext;
  const webgpu = hardwareNavigator.gpu !== undefined;
  const profile = deviceMemory >= 8 && maxTextureSize >= 8192 ? 'high' : deviceMemory >= 4 ? 'medium' : 'low';

  return { deviceMemory, maxTextureSize, profile, webgl2, webgpu };
}
