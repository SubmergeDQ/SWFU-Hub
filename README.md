# SWFU-Hub · 宿舍电量

西南林业大学宿舍电费的查询客户端。核心是一张余额曲线：用最近 30 天的真实用电量反推出每天的余额，再按近 7 天日均预测到见底那天。

## 能做什么

- 实时剩余电量、电价、电表合闸状态
- 余额曲线：历史实线 + 预测虚线，橙色竖线标出「今天」
- 近 7 天 / 近 30 天日均、本期累计、预计可用天数与见底日期
- 用电明细：每日柱状图、月度账单、逐日记录
- 充值页按电价与日均换算「充多少度、能用几天」，并跳回学校缴费页

## 本地运行

```bash
npm install
npm run dev
```

首次打开需要粘贴公众号缴费页的链接（链接里的 `openId` 用来读取你自己的电表）。开发环境由 Vite 代理转发 `/kddz/*` 到校园服务器，绕开跨域限制。

生产环境可执行 `npm run build` 后用 `npm run serve`（`server/proxy.mjs` 同时托管静态文件和转发接口）。

## 打包安卓

```bash
npm run build
npx cap sync android
```

本机无法直连 `dl.google.com`，构建时需带上阿里云镜像的 init script：

```bash
cd android
gradle assembleDebug --init-script init.gradle
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。安卓壳里接口走 `CapacitorHttp` 原生请求，不受 WebView 的跨域与混合内容限制，所以清单里开启了 `usesCleartextTraffic`。

## 数据与限制

- 数据直接来自 `sdcz.swfu.edu.cn` 的「水电一体」系统，不做缓存改写。
- 缴费（付款）仍由学校系统处理，只有微信内才能拉起微信支付；App 内只负责换算和跳转。
- `openId` 只用于向学校服务器读取电表，本地保存在浏览器 / App 的 localStorage 中。
