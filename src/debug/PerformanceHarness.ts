export type DiagnosticMode = 'benchmark' | 'ai-stress';

export interface RuntimeMetrics {
  drawCalls: number;
  enemies: number;
  memoryMb: number | null;
  particles: number;
  textureMemoryEstimateMb: number;
  triangles: number;
}

export interface PerformanceReport extends RuntimeMetrics {
  averageFps: number;
  frameSpikes: number;
  onePercentLowFrameTimeMs: number;
  samples: number;
}

export const STRESS_TARGETS = [10, 20, 30, 40, 50];

export function stressTarget(elapsedSeconds: number, stageSeconds = 5): number {
  return STRESS_TARGETS[Math.min(STRESS_TARGETS.length - 1, Math.floor(elapsedSeconds / stageSeconds))];
}

export function summarizePerformance(frameTimesMs: number[], metrics: RuntimeMetrics): PerformanceReport {
  const samples = frameTimesMs.filter((value) => Number.isFinite(value) && value > 0);
  const averageFrameTime = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  const sorted = [...samples].sort((a, b) => a - b);
  const onePercentLowFrameTimeMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .99))] ?? 0;
  return {
    ...metrics,
    averageFps: Math.round(1000 / Math.max(averageFrameTime, .001)),
    frameSpikes: samples.filter((value) => value > 1000 / 30).length,
    onePercentLowFrameTimeMs: Math.round(onePercentLowFrameTimeMs * 100) / 100,
    samples: samples.length,
  };
}
