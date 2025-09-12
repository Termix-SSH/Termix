# 仓库统计

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> 英文</a> | 
  <img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/LukeGus/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/LukeGus/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/LukeGus/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

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
  <a href="https://github.com/LukeGus/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

如果你愿意，可以在这里支持这个项目！\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# 概览

<p align="center">
  <a href="https://github.com/LukeGus/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix 是一个开源、永久免费、自托管的一体化服务器管理平台。它提供了一个基于网页的解决方案，通过一个直观的界面管理你的服务器和基础设施。Termix
提供 SSH 终端访问、SSH 隧道功能以及远程文件编辑，还会陆续添加更多工具。

# 功能

- **SSH 终端访问** - 功能完整的终端，支持分屏（最多 4 个面板）和标签系统
- **SSH 隧道管理** - 创建和管理 SSH 隧道，支持自动重连和健康监控
- **远程文件编辑器** - 直接在远程服务器编辑文件，支持语法高亮和文件管理功能（上传、删除、重命名等）
- **SSH 主机管理器** - 保存、组织和管理 SSH 连接，支持标签和文件夹
- **服务器统计** - 查看任意 SSH 服务器的 CPU、内存和硬盘使用情况
- **用户认证** - 安全的用户管理，支持管理员控制、OIDC 和双因素认证（TOTP）
- **现代化界面** - 使用 React、Tailwind CSS 和 Shadcn 构建的简洁界面
- **语言支持** - 内置中英文支持

# 计划功能

- **增强管理员控制** - 提供更精细的用户和管理员权限控制、共享主机等功能
- **主题定制** - 修改所有工具的主题风格
- **增强终端支持** - 添加更多终端协议，如 VNC 和 RDP（有类似 Apache Guacamole 的 RDP 集成经验者请通过创建 issue 联系我）
- **移动端支持** - 支持移动应用或 Termix 网站移动版，让你在手机上管理服务器

# 安装

访问 Termix [文档](https://docs.termix.site/install) 获取安装信息。或者可以参考以下示例 docker-compose 文件：

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

如果你需要 Termix 的帮助，可以加入 [Discord](https://discord.gg/jVQGdvHDrf)
服务器并访问支持频道。你也可以在 [GitHub](https://github.com/LukeGus/Termix/issues) 仓库提交 issue 或 pull request。

# 展示

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="Termix Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="250" alt="Termix Demo 3"/>
  <img src="./repo-images/Image 4.png" width="250" alt="Termix Demo 4"/>
  <img src="./repo-images/Image 5.png" width="250" alt="Termix Demo 5"/>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/f9caa061-10dc-4173-ae7d-c6d42f05cf56" width="800" controls>
    你的浏览器不支持 video 标签。
  </video>
</p>

# 许可证

根据 Apache 2.0 许可证发布。更多信息请参见 LICENSE。