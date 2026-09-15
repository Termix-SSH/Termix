<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>自托管服务器管理，从 SSH 和远程桌面到自动化</p>

<p>
  <a href="../README.md">English</a> ·
  中文 ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-AR.md">العربية</a> ·
  <a href="README-HI.md">हिन्दी</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-VI.md">Tiếng Việt</a> ·
  <a href="README-IT.md">Italiano</a>
</p>

<p>
  <img src="https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks&color=F39044&labelColor=1a1a1a" />
  <img src="https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release&color=F39044&labelColor=1a1a1a&v=1" />
  <a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720?color=F39044&labelColor=1a1a1a" /></a>
  <a href="https://donate.termix.site/"><img alt="Donate" src="https://img.shields.io/badge/Donate-Support%20Termix-F39044?style=flat&labelColor=1a1a1a" /></a>
</p>

<p>
  <a href="https://donate.termix.site/"><img alt="Donations this month" src="https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=Donations%20this%20month&query=%24.fiatTotal&prefix=%24&url=https%3A%2F%2Ftermix.site%2Fdonation-snapshot.json&color=F39044&labelColor=1a1a1a" /></a>
</p>

<br />

Termix 免费且开源。如果您觉得它有用，请考虑[捐赠](https://donate.termix.site/)以帮助支付服务器费用和开发时间。

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>获得于 2025年9月1日</sub>
</p>

</div>

<br />

## 概览

Termix 是一个免费、开源、自托管的服务器管理平台。它把 SSH 终端、远程桌面（RDP、VNC、Telnet）、文件传输、隧道、Docker、指标和自动化集中在一个地方，支持网页端、桌面端和移动端。它是 Termius 的自托管替代品，并且永久免费。

<br />

## 功能

<table>
<tr>
<td width="50%" valign="top">

**SSH 终端:**
功能齐全的终端，配有类似浏览器的标签页和分屏，最多同时显示 6 个面板。可以选择主题、字体和配色。每个会话上方都有一个工具栏，显示实时的 CPU、内存和磁盘，并提供指向该主机文件、Docker、隧道和指标的快捷入口。

</td>
<td width="50%" valign="top">

**远程桌面:**
在浏览器中使用 RDP、VNC 和 Telnet，和其他会话一样支持标签页和分屏。包含 RDP 驱动器的文件浏览器和拖放上传。在 Windows 桌面端，你还可以用原生 RDP 客户端打开主机。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH 隧道:**
支持本地、远程和动态 SOCKS 转发，可自动重连并进行健康检查。桌面端的客户端到服务器隧道保存在本机，你也可以把预设保存到服务器，以便迁移到另一台客户端。

</td>
<td width="50%" valign="top">

**文件管理器:**
通过 SFTP 浏览、编辑、上传、下载、重命名、移动和删除文件，支持 sudo。可以查看和编辑代码、图片、音频和视频。文件可以直接从一台服务器复制到另一台，系统会自动选择最快的路径并校验传输完整性。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker 和 Podman:**
启动、停止、暂停和删除容器，查看它们的状态，并在容器内打开一个终端。同时支持 Docker 和 Podman。它不是要取代 Portainer 或 Dockge，只是用来管理你已有的容器。

</td>
<td width="50%" valign="top">

**主机管理:**
用标签和可命名、可配色的嵌套文件夹来整理主机。在多台主机之间复用已保存的凭据，自动部署 SSH 密钥，把主机归到父主机下，批量编辑和导出，还可以用快速连接处理那些不想保存的一次性连接。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**主机指标:**
在大多数 Linux 服务器上查看 CPU、内存、磁盘、网络、温度、运行时间、进程、端口、登录记录和系统信息，并附带历史曲线图。管理卡片让你无需离开 Termix 就能处理服务、定时任务、软件包、用户、防火墙规则、WireGuard、Tailscale、SSL 证书、日志和健康检查。

</td>
<td width="50%" valign="top">

**自动化:**
先选一个触发条件，再决定要做什么。触发条件包括指标超过阈值、主机上线或下线、健康检查状态变化、定时计划、容器事件，或者一个传入的 Webhook。步骤可以执行命令和代码片段、控制容器和隧道、唤醒主机、调用某个网址、等待、按条件分支、运行另一个自动化，并通过 ntfy、Discord 或 Webhook 通知你。测试运行让你先安全地试一遍。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**机群:**
通过手动挑选或标签规则把主机编成一个机群，新主机可以自动加入。一次在所有主机上执行同一条命令，向全部主机推送和拉取文件，安装软件包，并收集系统、内核、架构和运行时间的清单。

</td>
<td width="50%" valign="top">

**AI 助手:**
可选功能，默认关闭，需要你手动开启。接入 OpenAI、Anthropic、Gemini、Ollama 或任何兼容 OpenAI 的接口，向它询问你的配置。它可以读取主机、机群、代码片段和告警，并把改动作为建议提交给你确认，而不会自行修改。它永远无法接触凭据、用户和设置。管理员可以对整个实例关闭它，你也可以在初始设置时把它隐藏。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**登录与用户:**
支持本地账户，以及 OIDC、LDAP、GitHub 和 Google 登录，还有两步验证（TOTP）、通行密钥（WebAuthn）和受信任设备。管理员可以管理用户、把 OIDC 群组映射到角色、查看所有平台上的活动会话并将其吊销。你可以把本地账户和 OIDC 账户关联起来，并查看记录所有人操作的审计日志。

</td>
<td width="50%" valign="top">

**角色与共享:**
创建角色，并按四个级别把主机共享给用户或角色：连接、查看、编辑和管理。适用于所有认证方式和所有协议，并且可以覆盖共享主机所使用的凭据。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**告警:**
为 CPU、内存、磁盘等主机指标设置规则，触发时通过 ntfy、Discord 或 Webhook 通知你。在历史记录中查看正在触发和已恢复的告警，并忽略你不关心的那些。

</td>
<td width="50%" valign="top">

**主页:**
一个由你自己搭建的拖放小组件网格。小组件包括主机状态、Ping、服务链接、书签、搜索、时钟、日历、倒计时、便签、RSS、天气、图片、内嵌网页、Docker、隧道、指标图表、自定义 API，甚至还有一个实时终端。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**代码片段与工具:**
保存常用命令，一键执行，并支持主机变量和自定义输入。可以在所有已打开的终端中同时运行一条命令，也可以带自动补全地搜索命令历史。

</td>
<td width="50%" valign="top">

**会话共享:**
实时共享终端、RDP、VNC 或 Telnet 会话。可以发送一个无需账户即可加入的链接，也可以共享给指定的 Termix 用户，并选择只读或可读写。共享可以自动过期或随时撤销，也可以全局或按主机关闭。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**会话录制与日志:**
录制终端、RDP 和 VNC 会话，之后可以回放。可以下载会话的纯文本日志，也可以查看连接日志，了解连接过程中究竟发生了什么。

</td>
<td width="50%" valign="top">

**串口连接:**
从浏览器或桌面应用连接路由器、交换机和单片机等串口设备。可设置波特率、数据位、停止位和校验位。在支持的浏览器中使用 Web Serial API，在桌面应用中使用原生后端。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
从你的 tailnet 中拉取设备，点几下就能把它们添加为主机，并使用 Tailscale SSH 连接，由 tailnet ACL 负责访问控制，无需保存任何凭据。也支持 Headscale 和自定义接口地址。

</td>
<td width="50%" valign="top">

**Proxmox:**
直接从 Proxmox 实例导入主机，并在专属标签页中查看节点和虚拟机的状态，包括 CPU、内存和存储。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**工作区与标签页:**
保存一组标签页及其分屏布局，一键就能把整套重新打开。Termix 还会记住你上次的会话，所以刷新页面或换设备后标签页都会回来。

</td>
<td width="50%" valign="top">

**引导设置:**
一个简短的引导流程会带你选择界面预设、主题、需要的功能，以及第一台主机。简洁模式会隐藏你用不到的东西，你随时可以重新运行引导或切换预设。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**桌面独立运行与同步:**
桌面应用可以完全独立运行，自带本地后端和数据库，不需要服务器。你也可以把它连到 Termix 服务器，双向同步主机、凭据、代码片段等内容，并选择连接是在本地发起还是通过服务器发起。

</td>
<td width="50%" valign="top">

**命令行工具:**
`termix` 命令行工具，可用于你的终端和脚本。打开终端、在单台主机或整个机群上执行命令、通过 SFTP 传输文件，以及管理主机、代码片段和凭据。用 `npm install -g @termix-cli/cli` 安装，或者直接下载独立的可执行文件。详见 [CLI 文档](https://docs.termix.site/cli)。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**安全:**
密码、密钥和其他机密按用户加密，数据库文件本身也可以在磁盘上加密。具体原理请查看[文档](https://docs.termix.site/security)。

</td>
<td width="50%" valign="top">

**多语言:**
内置约 30 种语言，通过 [Crowdin](https://docs.termix.site/translations) 管理。

</td>
</tr>
</table>

<br />

<details>
<summary><b>更多功能</b></summary>
<br />

- **仪表盘** - 一眼看清你的服务器，卡片由你自己排布
- **网络拓扑图** - 根据你的主机绘制出你的家庭实验室，并显示实时状态
- **Tmux 监视器** - 浏览 tmux 的会话、窗口和面板，支持预览和搜索
- **API 密钥** - 面向用户的密钥，带有效期，可用于脚本和 CI
- **导出与导入** - 把主机、凭据和文件管理器数据导入导出
- **自动 SSL** - 自动签发和续期证书，并配置 HTTPS 跳转，也可以使用你自己的证书
- **数据库** - 默认使用 SQLite，同时支持 PostgreSQL 和 MySQL
- **现代界面** - 简洁的 React 界面，桌面和移动端都适用，提供浅色、深色和 Dracula 等主题。任何连接都能通过网址全屏打开
- **命令面板** - 双击左 Shift，用键盘直接跳到某台主机
- **键盘快捷键** - 在标签页之间切换、关闭标签页等，全部可以重新绑定
- **网络唤醒** - 从 Termix 或自动化步骤中唤醒一台机器
- **受信任代理认证** - 由反向代理完成登录，并把用户信息传递进来
- **丰富的 SSH 功能** - 跳板机、Warpgate、TOTP 验证、SOCKS5、主机密钥验证、密码自动填充、[OPKSSH](https://github.com/openpubkey/opkssh)、tmux、端口敲门、终端日志、代理转发、Bitwarden SSH 代理、HashiCorp Vault SSH 签名等等
- **Termix ID** - 内置的 sshid.io 式功能。认领一个用户名，在解析地址上发布你的公钥，并用内置 CA 签发 SSH 证书

</details>

<br />

## 平台支持

<table align="center">
<tr>
<th align="center">平台</th>
<th align="center">发行方式</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>任何现代浏览器（Chrome、Safari、Firefox）· 支持 PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>便携版 · MSI 安装程序 · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>便携版 · AUR · AppImage · Deb · Flatpak</td>
</tr>
<tr>
<td align="center"><b>macOS</b> <sub>x64/ia32, v12.0+</sub></td>
<td>Apple App Store · DMG · Homebrew</td>
</tr>
<tr>
<td align="center"><b>iOS/iPadOS</b> <sub>v15.1+</sub></td>
<td>Apple App Store · IPA</td>
</tr>
<tr>
<td align="center"><b>Android</b> <sub>v7.0+</sub></td>
<td>Google Play Store · APK</td>
</tr>
</table>

<br />

## 安装

访问 [Termix 文档](https://docs.termix.site/install) 查看所有平台的完整安装说明。

Docker Compose 示例（如果你不打算使用远程桌面功能，可以省略 `guacd` 和相关网络配置）：

```yaml
services:
  termix:
    image: ghcr.io/lukegus/termix:latest
    container_name: termix
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - termix-data:/app/data
    environment:
      PORT: "8080"
    depends_on:
      - guacd
    networks:
      - termix-net

  guacd:
    image: guacamole/guacd:1.6.0
    container_name: guacd
    restart: unless-stopped
    ports:
      - "4822:4822"
    networks:
      - termix-net

volumes:
  termix-data:
    driver: local

networks:
  termix-net:
    driver: bridge
```

部署多个 Termix 后端实例时，请为所有实例配置相同的 `REDIS_URL`，并可选配置
`TERMIX_REDIS_PREFIX`。Redis 会同步协作房间的在线成员、控制请求、控制权和事件，
也会把 Step CA OAuth 回调路由回持有用户终端的实例；可通过
`TERMIX_STEP_CA_REDIS_PREFIX` 隔离这些短期加密消息。实时 SSH 与远程桌面传输仍
依附于创建连接的后端实例，因此负载均衡器需要保持 WebSocket 会话亲和性。
单实例部署无需 Redis。

### 命令行工具

Termix 还提供命令行工具，你可以在终端里管理服务器，也可以把 Termix 用在自己的脚本中。

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

它可以打开终端、在单台主机或整个机群上执行命令、通过 SFTP 传输文件，以及管理主机、代码片段和凭据。完整文档见 [docs.termix.site/cli](https://docs.termix.site/cli)。

### 云端部署

你也可以把 Termix 服务端跑在 VPS 上，而不是自己的内网里。如果 Termix 就运行在它所管理的网络中，一旦网络出问题，Termix 也会跟着一起挂掉，而这恰恰是你最需要它的时候。放在外面运行可以保证它始终可达，还能获得固定 IP，不用 VPN 或端口转发就能从任何地方接入。

[GINERNET](https://docs.termix.site/install/ginernet) 是 Termix 的赞助商，文档里有部署到他们 VPS 平台的分步指南。

<br />

## 遥测

Termix 每天会发送一次匿名的小型统计信息，让我了解有多少实例在运行、哪些功能被用到。内容包括一个随机的实例 ID、你有多少用户和主机、应用版本，以及过去 24 小时内使用了哪些功能（终端、文件管理器、隧道、Docker 等）。它绝不包含用户名、主机名、IP 地址、凭据，或任何能识别你和你服务器的信息。

该功能默认开启。你可以在管理设置的“通用”中关闭它，或者在启动 Termix 之前设置 `ENABLE_TELEMETRY=false`。

<br />

## 捐赠

Termix 免费且开源，没有订阅也没有付费方案。如果你觉得它有用，可以考虑捐赠，帮忙分担服务器、域名和开发时间的成本。捐赠还能支持研究和学习 SAML、Kubernetes、Agent 等功能所需的时间。可以在下方查看进展并捐赠。

[捐赠](https://donate.termix.site/)

<br />

## 赞助商

有意通过付费展示位支持开发吗？请发邮件到 [mail@termix.site](mailto:mail@termix.site)。

<div align="center">

<br />

<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="40" alt="DigitalOcean" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://crowdin.com/">
  <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="40" alt="Crowdin" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.blacksmith.sh/">
  <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://rackgenius.com/rackgenius-logo.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://ginernet.com/img/logo-web.png" height="40" alt="Ginernet" />
</a>
</div>

<br />

## 支持

需要帮助或想提功能建议？可以[新建一个 issue](https://github.com/Termix-SSH/Support/issues)，尽量写清楚细节，如果方便请用英文。你也可以在 [Discord](https://discord.gg/jVQGdvHDrf) 的支持频道提问，不过那边回复可能会慢一些。

<br />

## 展示

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>在 YouTube 上观看版本更新介绍</sub>

<br />
<br />

<table>
<tr>
<td><img src="../repo-images/Image 1.png" alt="Termix Screenshot 1" width="400" /></td>
<td><img src="../repo-images/Image 2.png" alt="Termix Screenshot 2" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 3.png" alt="Termix Screenshot 3" width="400" /></td>
<td><img src="../repo-images/Image 4.png" alt="Termix Screenshot 4" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 5.png" alt="Termix Screenshot 5" width="400" /></td>
<td><img src="../repo-images/Image 6.png" alt="Termix Screenshot 6" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 7.png" alt="Termix Screenshot 7" width="400" /></td>
<td><img src="../repo-images/Image 8.png" alt="Termix Screenshot 8" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 9.png" alt="Termix Screenshot 9" width="400" /></td>
<td><img src="../repo-images/Image 10.png" alt="Termix Screenshot 10" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 11.png" alt="Termix Screenshot 11" width="400" /></td>
<td><img src="../repo-images/Image 12.png" alt="Termix Screenshot 12" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 13.png" alt="Termix Screenshot 13" width="400" /></td>
<td><img src="../repo-images/Image 14.png" alt="Termix Screenshot 14" width="400" /></td>
</tr>
<tr>
<td><img src="../repo-images/Image 15.png" alt="Termix Screenshot 15" width="400" /></td>
<td><img src="../repo-images/Image 16.png" alt="Termix Screenshot 16" width="400" /></td>
</tr>
</table>

<sub>部分视频和图片可能已经过时，或者不能完整展示功能。</sub>

</div>

<br />

## 计划功能

所有计划中的功能都在 [Projects](https://github.com/orgs/Termix-SSH/projects/5) 里。如果你想参与贡献，请查看[贡献指南](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)。

<br />

## 许可证

基于 Apache License 2.0 发布。详见 `LICENSE`。
