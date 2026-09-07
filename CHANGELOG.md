# Changelog

## Unreleased — 模型與配裝更新

- 20 把武器使用不同輪廓的低多邊形程序模型，包含左輪彈巢、散彈槍護木、狙擊瞄具、Minigun 旋轉槍管與能量武器發光部件。
- 14 種附件反映在武器模型上；同類瞄具與槍管顯示最後取得者，狙擊槍保留預設瞄具外觀。保留原有附件數值與取得方式。
- 換彈、槍機及熱度驅動模型部件；槍口燈、曳光與彈殼分別對齊實際槍口和槍身方向。
- 武器庫支援類別與文字共同篩選，直接配至五個欄位；配裝以穩定武器 ID 保存，舊存檔及損壞欄位會取得合理預設值。設定儲存、結算與每日挑戰不覆寫個人配裝。
- 新增滾輪換槍，遵守 shotgun-only 規則；重按目前武器欄位不再中斷換彈。
- 武器模型依需求建立並重用，靜態同材質部件合併；測試確認 20 把武器切換兩輪未增加幾何資源。
- 修正重用曳光的包圍球，避免移到新位置後被錯誤剔除；Boss 只建立當前種類的識別幾何，保留遠距識別部件、弱點與攻擊發光，修正重型 Boss 的寬度縮放。

驗證：單元測試 28/28、完整 Chromium 瀏覽器測試 23/23，模型畫面追加檢查 4/4；lint、typecheck、build、assets:check 通過。檢視狙擊槍、散彈槍、Minigun、Railgun 的實際畫面；既有 25 敵人 benchmark 與 10–50 敵人壓力測試的繪製呼叫／三角形預算仍通過。未聲稱實體裝置 FPS 提升；模型維持程序化低多邊形風格。

修改檔案：`src/weapons/Models.ts`、`src/effects/ShotEffects.ts`、`src/main.js`、`src/core/SaveManager.ts`、`index.html`、`src/style.css`、`test/weapon-models.test.js`、`test/effects.test.js`、`test/rules.test.js`、`e2e/models.spec.ts`、`README.md`、`CHANGELOG.md`。無新增依賴。

## 0.1.0

- Initial playable browser FPS with three maps, five modes, twenty weapon definitions, twelve enemy archetypes, local progression, and test controls.
