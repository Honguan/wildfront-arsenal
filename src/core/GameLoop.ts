export interface FixedStepResult {
  alpha: number;
  steps: number;
}

export function createFixedStep(step = 1 / 60, maxSteps = 5) {
  let accumulator = 0;
  return (frameDelta: number, update: (delta: number) => void): FixedStepResult => {
    accumulator = Math.min(accumulator + Math.max(0, frameDelta), step * maxSteps);
    let steps = 0;
    while (accumulator >= step) {
      update(step);
      accumulator -= step;
      steps += 1;
    }
    return { alpha: accumulator / step, steps };
  };
}
