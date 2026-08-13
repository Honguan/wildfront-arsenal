export type RecoilProfileId = 'sidearm' | 'smg' | 'rifle' | 'shotgun' | 'precision' | 'heavy' | 'energy';

export const RECOIL_PROFILES = {
  sidearm: { cameraKick: .011, weaponKick: .055, recovery: .08, adsMultiplier: .72, moveSpread: 1.35, pattern: [[0, 1], [.35, 1.08], [-.25, 1.12], [.18, 1.18]] },
  smg: { cameraKick: .007, weaponKick: .045, recovery: .075, adsMultiplier: .68, moveSpread: 1.55, pattern: [[-.35, 1], [.2, 1.05], [.48, 1.08], [-.15, 1.12], [-.5, 1.14], [.3, 1.16]] },
  rifle: { cameraKick: .009, weaponKick: .06, recovery: .07, adsMultiplier: .65, moveSpread: 1.45, pattern: [[-.18, 1], [.12, 1.08], [.38, 1.14], [.2, 1.2], [-.28, 1.23], [-.45, 1.25]] },
  shotgun: { cameraKick: .025, weaponKick: .12, recovery: .11, adsMultiplier: .78, moveSpread: 1.28, pattern: [[0, 1], [.35, 1.08], [-.3, 1.12]] },
  precision: { cameraKick: .021, weaponKick: .15, recovery: .095, adsMultiplier: .58, moveSpread: 1.8, pattern: [[0, 1], [.15, 1.04], [-.12, 1.08]] },
  heavy: { cameraKick: .012, weaponKick: .075, recovery: .055, adsMultiplier: .72, moveSpread: 1.6, pattern: [[-.2, 1], [.25, 1.08], [.42, 1.14], [.05, 1.2], [-.38, 1.24], [-.18, 1.27]] },
  energy: { cameraKick: .008, weaponKick: .05, recovery: .085, adsMultiplier: .62, moveSpread: 1.4, pattern: [[0, 1], [.25, 1.06], [-.25, 1.06], [.4, 1.12], [-.4, 1.12]] },
} as const;

export function recoilFor(profileId: RecoilProfileId, shot: number, ads = false) {
  const profile = RECOIL_PROFILES[profileId];
  const [horizontal, vertical] = profile.pattern[shot % profile.pattern.length];
  const multiplier = ads ? profile.adsMultiplier : 1;
  return {
    pitch: vertical * profile.cameraKick * multiplier,
    yaw: horizontal * profile.cameraKick * multiplier,
    weaponKick: profile.weaponKick * multiplier,
  };
}
