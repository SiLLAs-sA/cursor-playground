# Cursor Playground

一个在浏览器中制作自定义鼠标光标的静态网站。可以上传图片、抠图裁剪、添加光标组件、调整风格与点击热点，并导出单个 PNG 或光标套装 ZIP。图片和保存的作品留在当前浏览器中，不需要注册账号。

在线体验：[Vercel 版本](https://cursorplayground-omega.vercel.app/) · [Cloudflare 版本](https://cursor-playground.cursorplayground.workers.dev/)

## 在自己的电脑上运行

下载本仓库后，在项目根目录运行：

```sh
python3 -m http.server 4173 --directory dist
```

然后打开 <http://localhost:4173/>。如果电脑上没有 Python 3，也可以用任意静态文件服务器托管 `dist/`。网站使用哈希路由，不需要后端或数据库；不要直接双击打开 `dist/index.html`，浏览器对本地文件的限制可能影响功能。

## 部署

`dist/` 中已经包含网站所需的 HTML、CSS、JavaScript 和图标，无需构建。Vercel 可以从仓库根目录部署，`vercel.json` 会指定 `dist/` 为输出目录。Cloudflare Workers 的配置在 `cloudflare.config.ts` 与 `wrangler.config.ts` 中，可通过 `cf deploy` 部署。

## 主要功能

- 上传 PNG、JPG、WebP（最大 15 MB），或使用内置示例。
- 移动、缩放、旋转图片；用套索、多边形或心形、星形、方形、三角形、圆形选区裁剪，也可使用画笔擦除和恢复。
- 调整像素、双色、波点、素描、复古网屏等效果。
- 添加并调整箭头、输入、帮助、禁用、选择、忙碌、链接、移动和缩放等光标组件。
- 批量生成多个光标状态，逐个调整位置、大小和热点，然后导出套装 ZIP。
- 预览实际光标、测试点击热点，并把作品保存在当前浏览器的 IndexedDB 中。

PNG 不会自动安装成系统光标；套装中的角色与热点数据保存在单独的 JSON 清单中。浏览器本地保存的作品不会跨设备或跨域名同步。

## 使用许可

本仓库目前未附带开源许可证。如需在本机体验之外复用、修改、再发布或商业使用代码，请先联系仓库所有者取得许可。
