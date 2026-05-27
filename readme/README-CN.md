<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>自托管 SSH 管理与远程桌面访问平台</p>

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
</p>

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

Termix 是一个开源、永久免费、自托管的一体化服务器管理平台。它提供了一个多平台解决方案，通过一个直观的界面管理你的服务器和基础设施。Termix 提供 SSH 终端访问、远程桌面控制（RDP、VNC、Telnet）、SSH 隧道功能、远程 SSH 文件管理以及许多其他工具。Termix 是适用于所有平台的完美免费自托管 Termius 替代品。

<br />

## 功能

<table>
<tr>
<td width="50%" valign="top">

**SSH 终端访问:**
功能齐全的终端，支持分屏（最多 4 个面板），并配有类似浏览器的标签系统。包括对自定义终端的支持，如常用的终端主题、字体和其他组件。

</td>
<td width="50%" valign="top">

**远程桌面访问:**
通过浏览器支持 RDP、VNC 和 Telnet，具有完整的自定义和分屏功能。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH 隧道管理:**
创建和管理具有自动重连和健康监测功能的服务器间 SSH 隧道，支持本地、远程或动态 SOCKS 转发。桌面客户端到服务器的隧道设置按桌面安装本地存储，可选的 C2S 预设快照可保存到服务器、重命名、加载或删除，以便在客户端之间迁移本地隧道配置。

</td>
<td width="50%" valign="top">

**远程文件管理器:**
直接在远程服务器上管理文件，支持查看和编辑代码、图像、音频和视频。支持通过 sudo 无缝上传、下载、重命名、删除和移动文件。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker 管理:**
启动、停止、暂停、移除容器。查看容器统计信息。通过 docker exec 终端控制容器。它的初衷不是取代 Portainer 或 Dockge，而是为了比直接创建容器更简单地管理它们。

</td>
<td width="50%" valign="top">

**SSH 主机管理器:**
通过标签和文件夹保存、组织和管理您的 SSH 连接，轻松保存可重用的登录信息，并能自动化部署 SSH 密钥。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**服务器统计:**
在大多数基于 Linux 的服务器上查看 CPU、内存、磁盘使用情况以及网络、运行时间、系统信息、防火墙和端口监控。

</td>
<td width="50%" valign="top">

**用户认证:**
安全的用户管理，具有管理员控制、OIDC（带访问控制）和 2FA (TOTP) 支持。查看所有平台上的活动用户会话并撤销权限。将您的 OIDC/本地账户链接在一起。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
创建角色并在用户/角色之间共享主机。

</td>
<td width="50%" valign="top">

**数据库加密:**
后端存储为加密的 SQLite 数据库文件。查看[文档](https://docs.termix.site/security)了解更多。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**网络图:**
自定义您的仪表板，根据您的 SSH 连接可视化您的家庭实验室，并支持状态监测。

</td>
<td width="50%" valign="top">

**SSH 工具:**
创建可重用的命令片段，只需点击一下即可执行。在多个打开的终端中同时运行一个命令。

</td>
</tr>
<tr>
<td width="50%" valign="top">

**持久标签页:**
如果在用户个人资料中启用，SSH 会话和标签页将在设备/刷新后保持打开状态。

</td>
<td width="50%" valign="top">

**语言:**
内置支持约 30 种语言（由 [Crowdin](https://docs.termix.site/translations) 管理）。

</td>
</tr>
</table>

<br />

<details>
<summary><b>更多功能</b></summary>
<br />

- **仪表板** - 在仪表板上一目了然地查看服务器信息
- **API 密钥** - 创建带有到期日期的用户范围 API 密钥，用于自动化/CI
- **数据导出/导入** - 导出和导入 SSH 主机、凭据和文件管理器数据
- **自动 SSL 设置** - 内置 SSL 证书生成和管理，支持 HTTPS 重定向
- **现代 UI** - 使用 React、Tailwind CSS 和 Shadcn 构建的整洁的桌面/移动友好界面。有多种 UI 主题可选，包括浅色、深色、Dracula 等。使用 URL 路由全屏打开任何连接。
- **命令历史** - 自动完成并查看之前运行过的 SSH 命令
- **快速连接** - 无需保存连接数据即可连接到服务器
- **命令面板** - 双击左 Shift 键即可通过键盘快速访问 SSH 连接
- **丰富的 SSH 功能** - 支持跳转主机、Warpgate、基于 TOTP 的连接、SOCKS5、主机密钥验证、密码自动填充、[OPKSSH](https://github.com/openpubkey/opkssh)、tmux、端口敲击等

</details>

<br />

## 平台支持

<table align="center">
<tr>
<th align="center">平台</th>
<th align="center">发行版</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>任何现代浏览器（Chrome、Safari、Firefox）· PWA 支持</td>
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

访问 [Termix 文档](https://docs.termix.site/install) 了解有关如何在所有平台上安装 Termix 的更多信息。此外，这里有一个示例 Docker Compose 文件（如果您不打算使用远程桌面功能，可以省略 guacd 和网络部分）：

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

<br />

## 展示

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>在 YouTube 上观看更新概览</sub>

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
</table>

<sub>某些视频和图像可能已过时，或者可能无法完美展示功能。</sub>

</div>

<br />

## 计划功能

查看 [Projects](https://github.com/orgs/Termix-SSH/projects/2) 了解所有计划功能。如果您想贡献代码，请参阅 [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)。

<br />

## 赞助商

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
<a href="https://tailscale.com/">
  <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="40" alt="Tailscale" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="40" alt="AWS" />
</a>

</div>

<br />

## 支持

如果您需要 Termix 的帮助或想要请求功能，请访问 [Issues](https://github.com/Termix-SSH/Support/issues) 页面，登录并点击 `New Issue`。请尽可能详细地描述您的问题，建议使用英语。您也可以加入 [Discord](https://discord.gg/jVQGdvHDrf) 服务器并访问支持频道，但响应时间可能较长。

<br />

## 许可证

根据 Apache License Version 2.0 发布。更多信息请参见 `LICENSE`。
