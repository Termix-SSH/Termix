# 仓库统计

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> 英文</a> | 
  <img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">2025年9月1日获得</small>
</p>

#### 核心技术

[![React Badge](https://img.shields.io/badge/-React-61DBFB?style=flat-square&labelColor=black&logo=react&logoColor=61DBFB)](#)
[![TypeScript Badge](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&labelColor=black&logo=typescript&logoColor=3178C6)](#)
[![Node.js Badge](https://img.shields.io/badge/-Node.js-3C873A?style=flat-square&labelColor=black&logo=node.js&logoColor=3C873A)](#)
[![Vite Badge](https://img.shields.io/badge/-Vite-646CFF?style=flat-square&labelColor=black&logo=vite&logoColor=646CFF)](#)
[![Tailwind CSS Badge](https://img.shields.io/badge/-TailwindCSS-38B2AC?style=flat-square&labelColor=black&logo=tailwindcss&logoColor=38B2AC)](#)
[![Docker Badge](https://img.shields.io/badge/-Docker-2496ED?style=flat-square&labelColor=black&logo=docker&logoColor=2496ED)](#)
[![SQLite Badge](https://img.shields.io/badge/-SQLite-003B57?style=flat-square&labelColor=black&logo=sqlite&logoColor=003B57)](#)
[![Radix UI Badge](https://img.shields.io/badge/-Radix%20UI-161618?style=flat-square&labelColor=black&logo=radixui&logoColor=161618)](#)

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

如果你愿意，可以在这里支持这个项目！\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# 概览

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix 是一个开源、永久免费、自托管的一体化服务器管理平台。它提供了一个基于网页的解决方案，通过一个直观的界面管理你的服务器和基础设施。Termix
提供 SSH 终端访问、SSH 隧道功能以及远程文件管理，还会陆续添加更多工具。

# 功能

- **SSH 终端访问** - 功能完整的终端，支持分屏（最多 4 个面板）和标签系统
- **SSH 隧道管理** - 创建和管理 SSH 隧道，支持自动重连和健康监控
- **远程文件管理器** - 直接在远程服务器上管理文件，支持查看和编辑代码、图片、音频和视频。无缝上传、下载、重命名、删除和移动文件。
- **SSH 主机管理器** - 保存、组织和管理 SSH 连接，支持标签和文件夹，轻松保存可重用的登录信息，同时能够自动部署 SSH 密钥
- **服务器统计** - 查看任意 SSH 服务器的 CPU、内存和硬盘使用情况
- **用户认证** - 安全的用户管理，支持管理员控制、OIDC 和双因素认证（TOTP）
- **数据库加密** - SQLite 数据库文件在静态时加密，支持自动加密/解密
- **数据导出/导入** - 导出和导入 SSH 主机、凭据和文件管理器数据，支持增量同步
- **自动 SSL 设置** - 内置 SSL 证书生成和管理，支持 HTTPS 重定向
- **现代化界面** - 使用 React、Tailwind CSS 和 Shadcn 构建的简洁桌面/移动友好界面
- **语言支持** - 内置英语、中文和德语支持
- **平台支持** - 提供 Web 应用、桌面应用程序（Windows 和 Linux）以及 iOS 和 Android 专用移动应用。计划支持 macOS 和 iPadOS。

# 计划功能

查看 [项目](https://github.com/orgs/Termix-SSH/projects/2) 了解所有计划功能。如果你想贡献代码，请参阅 [贡献指南](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md)。

# 安装

支持的设备：

- 网站（任何现代浏览器，如 Google、Safari 和 Firefox）
- Windows（应用程序）
- Linux（应用程序）
- iOS（应用程序）
- Android（应用程序）
- iPadOS 和 macOS 正在开发中

访问 Termix [文档](https://docs.termix.site/install) 获取所有平台的安装信息。或者可以参考以下示例 docker-compose 文件：

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

volumes:
  termix-data:
    driver: local
```

# 支持

如果你需要 Termix 的帮助或想要请求功能，请访问 [Issues](https://github.com/Termix-SSH/Support/issues) 页面，登录并点击 `New Issue`。
请尽可能详细地描述你的问题，最好使用英语。你也可以加入 [Discord](https://discord.gg/jVQGdvHDrf) 服务器并访问支持
频道，但响应时间可能较长。

# 展示

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="Termix Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="400" alt="Termix Demo 3"/>
  <img src="./repo-images/Image 4.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="./repo-images/Image 5.png" width="400" alt="Termix Demo 5"/>
  <img src="./repo-images/Image 6.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="./repo-images/Image 7.png" width="400" alt="Termix Demo 7"/>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/88936e0d-2399-4122-8eee-c255c25da48c" width="800" controls>
    你的浏览器不支持 video 标签。
  </video>
</p>

# 许可证

根据 Apache License Version 2.0 发布。更多信息请参见 LICENSE。
