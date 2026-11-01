// 异步小工具。原先 restart-desktop.js / rewind.js / macos-asar-handoff.js
// 各自定义了一份等价的 sleep。
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));