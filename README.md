# 桌邊 table-games

面對面聚會用的桌遊手機小幫手（每人一支手機，只負責發身分、投票、記錄）。

## 目前進度
- 阿瓦隆：完成（含梅林、派西維爾、莫甘娜、蘭斯洛特、巫婆、湖中仙女、神劍等擴充角色）
- 一夜終極狼人：製作中
- 誰是臥底：舊的單機版，尚未搬進新架構
- 連線：Firebase Realtime Database 的部分尚未實測

## 結構
- `src/core.js` 房間與連線層（事件記錄＋重播，伺服器不需懂規則）
- `src/avalon.js` 阿瓦隆規則引擎
- `src/app.js`、`src/style.css` 手機介面
- `build.js` 產生 `dist/`（`index.html`、`config.js`、`artifact.html`）
- `test/` 規則測試（`node test/fuzz.js`、`node test/scenarios.js`）與瀏覽器測試

## 使用
`node build.js` 後，開啟 `dist/index.html` 可單機示範；網址加 `?local=1` 可在同一瀏覽器多分頁測試。
正式連線需把 Firebase 設定貼進 `dist/config.js`。
