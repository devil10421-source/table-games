'use strict';
const fs = require('fs'), path = require('path');
const R = function (f) { return fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'); };
const css = R('style.css'), core = R('core.js'), av = R('avalon.js'), app = R('app.js');
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });
const safe = function (js) { return js.replace(/<\/script/gi, '<\\/script'); };

const body = '<div id="root"></div>\n<nav id="tabs" class="tabs" hidden aria-label="分頁"></nav>\n';
const scripts = '<script>' + safe(core) + '</script>\n<script>' + safe(av) + '</script>\n<script>' + safe(app) + '</script>\n';

/* 正式版：完整網頁 + 另一個 config.js 放伺服器設定 */
const full = '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="color-scheme" content="light dark">\n' +
  '<title>桌邊</title>\n<style>\n' + css + '</style>\n</head>\n<body>\n' + body +
  '<script src="config.js"></script>\n' + scripts + '</body>\n</html>\n';
fs.writeFileSync(path.join(dist, 'index.html'), full);

const cfgStub = '/* 把 Firebase 給你的設定貼在下面（照教學做）。沒貼之前，網頁只能單機示範。 */\n' +
  'window.TABLE_CONFIG = {\n  firebase: {\n    apiKey: "",\n    authDomain: "",\n    databaseURL: "",\n    projectId: "",\n    appId: ""\n  }\n};\n';
fs.writeFileSync(path.join(dist, 'config.js'), cfgStub);

/* Claude 作品版：標題在最前面、沒有 doctype/html/head/body，只能示範 */
const art = '<title>桌邊</title>\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>\n' + css + '</style>\n' + body + scripts;
fs.writeFileSync(path.join(dist, 'artifact.html'), art);
console.log('built', fs.statSync(path.join(dist, 'index.html')).size, fs.statSync(path.join(dist, 'artifact.html')).size);
