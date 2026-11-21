# 网页模型直连

2026-11-21 按站主明确授权，`public-model.js` 包含供访客免费使用的公开 DeepSeek API Key。它会随 GitHub Pages 发布，浏览器直接请求 `https://api.deepseek.com/chat/completions`，两页无需填写密钥，也不再通过 Cloudflare Worker。

修改或停用该公开凭据后，要更新 `public-model.js` 并递增其导入版本；DeepSeek 控制台撤销 Key 可立即停止该 Key 的调用。前端配置不提供账户费用隔离或可靠预算限制。

主页右下角使用不蒜子服务显示访问次数（PV）与访客人数（UV）。本次仅主页加载统计脚本；数字代表该服务实际记录的访问，不能补算接入前历史流量。服务不可用时显示破折号，不显示虚构数字。
