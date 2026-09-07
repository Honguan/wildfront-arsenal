# Wildfront Arsenal

[▶ PLAY ONLINE](https://honguan.github.io/wildfront-arsenal/)

Browser-based roguelite FPS. No installation required.

目前包含：

- 3 張可玩地圖、9 種天氣資料、5 種遊戲模式
- 20 把武器、12 種敵人、Elite traits、5 種 Boss
- 20 種武器模型、14 種可見附件、換彈／槍機／熱度動畫；武器庫分類配裝與本機配裝保存
- 波次、16 種 Perk、14 種 World Modifier、Daily Challenge、Custom Game、Seed 分享
- 本機成就與完整統計、可及性設定、自動效能降級

## Controls

- WASD — Move
- Mouse — Aim
- LMB — Fire
- RMB — ADS
- R — Reload
- F — Inspect weapon
- V — Melee
- 1–5 / Mouse wheel — Switch weapons
- Shift — Sprint
- Ctrl — Crouch
- Space — Jump / Vault
- Esc — Pause

## Local development

```bash
npm ci
npm run dev
```

完整驗證：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run assets:check
npm run test:e2e
```

開發工具：`?debug=1` 顯示效能資訊；`?test=1` 另提供 `window.__GAME_TEST__`。
