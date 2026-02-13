# Статистика репозитория

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English</a> ·
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <a href="README-JA.md"><img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語</a> ·
  <a href="README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <a href="README-FR.md"><img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français</a> ·
  <a href="README-DE.md"><img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch</a> ·
  <a href="README-ES.md"><img src="https://flagcdn.com/es.svg" alt="Español" width="24" height="16"> Español</a> ·
  <a href="README-PT.md"><img src="https://flagcdn.com/br.svg" alt="Português" width="24" height="16"> Português</a> ·
  <img src="https://flagcdn.com/ru.svg" alt="Русский" width="24" height="16"> Русский ·
  <a href="README-AR.md"><img src="https://flagcdn.com/sa.svg" alt="العربية" width="24" height="16"> العربية</a> ·
  <a href="README-HI.md"><img src="https://flagcdn.com/in.svg" alt="हिन्दी" width="24" height="16"> हिन्दी</a> ·
  <a href="README-TR.md"><img src="https://flagcdn.com/tr.svg" alt="Türkçe" width="24" height="16"> Türkçe</a> ·
  <a href="README-VI.md"><img src="https://flagcdn.com/vn.svg" alt="Tiếng Việt" width="24" height="16"> Tiếng Việt</a> ·
  <a href="README-IT.md"><img src="https://flagcdn.com/it.svg" alt="Italiano" width="24" height="16"> Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Достигнуто 1 сентября 2025 года</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

Если хотите, вы можете поддержать проект здесь!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Обзор

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix — это платформа для управления серверами с открытым исходным кодом, навсегда бесплатная и размещаемая на собственном сервере. Она предоставляет мультиплатформенное решение для управления вашими серверами и инфраструктурой через единый интуитивно понятный интерфейс. Termix предлагает доступ к SSH-терминалу, возможности SSH-туннелирования, удалённое управление файлами и множество других инструментов. Termix — это идеальная бесплатная альтернатива Termius с возможностью размещения на собственном сервере, доступная для всех платформ.

# Возможности

- **Доступ к SSH-терминалу** — Полнофункциональный терминал с поддержкой разделения экрана (до 4 панелей) и системой вкладок, как в браузере. Включает поддержку настройки терминала, включая популярные темы, шрифты и другие компоненты
- **Управление SSH-туннелями** — Создание и управление SSH-туннелями с автоматическим переподключением и мониторингом состояния, с поддержкой соединений -l и -r
- **Удалённый файловый менеджер** — Управление файлами непосредственно на удалённых серверах с поддержкой просмотра и редактирования кода, изображений, аудио и видео. Загрузка, скачивание, переименование, удаление и перемещение файлов с поддержкой sudo
- **Управление Docker** — Запуск, остановка, приостановка, удаление контейнеров. Просмотр статистики контейнеров. Управление контейнером через терминал docker exec. Не предназначен для замены Portainer или Dockge, а скорее для простого управления контейнерами по сравнению с их созданием
- **Менеджер SSH-хостов** — Сохранение, организация и управление SSH-подключениями с помощью тегов и папок, с возможностью сохранения данных для повторного входа и автоматизации развёртывания SSH-ключей
- **Статистика сервера** — Просмотр использования CPU, памяти и диска, а также сети, времени работы, информации о системе, файрвола и монитора портов на большинстве серверов на базе Linux
- **Панель управления** — Просмотр информации о сервере на панели управления одним взглядом
- **RBAC** — Создание ролей и предоставление общего доступа к хостам для пользователей/ролей
- **Аутентификация пользователей** — Безопасное управление пользователями с административным контролем и поддержкой OIDC и 2FA (TOTP). Просмотр активных сессий пользователей на всех платформах и отзыв прав доступа. Связывание аккаунтов OIDC/локальных аккаунтов
- **Шифрование базы данных** — Бэкенд хранится в виде зашифрованных файлов базы данных SQLite. Подробнее в [документации](https://docs.termix.site/security)
- **Экспорт/импорт данных** — Экспорт и импорт SSH-хостов, учётных данных и данных файлового менеджера
- **Автоматическая настройка SSL** — Встроенная генерация и управление SSL-сертификатами с перенаправлением на HTTPS
- **Современный интерфейс** — Чистый интерфейс для десктопа и мобильных устройств, построенный на React, Tailwind CSS и Shadcn. Выбор между тёмной и светлой темой. Использование URL-маршрутов для открытия любого подключения в полноэкранном режиме
- **Языки** — Встроенная поддержка ~30 языков (управляется через [Crowdin](https://docs.termix.site/translations))
- **Поддержка платформ** — Доступен как веб-приложение, настольное приложение (Windows, Linux и macOS), PWA и специализированное мобильное/планшетное приложение для iOS и Android
- **Инструменты SSH** — Создание переиспользуемых фрагментов команд, выполняемых одним нажатием. Запуск одной команды одновременно в нескольких открытых терминалах
- **История команд** — Автодополнение и просмотр ранее выполненных SSH-команд
- **Быстрое подключение** — Подключение к серверу без необходимости сохранения данных подключения
- **Командная палитра** — Двойное нажатие левого Shift для быстрого доступа к SSH-подключениям с клавиатуры
- **Богатый функционал SSH** — Поддержка jump-хостов, Warpgate, подключений на основе TOTP, SOCKS5, верификации ключей хоста, автозаполнения паролей, [OPKSSH](https://github.com/openpubkey/opkssh) и др.
- **Сетевой граф** — Настройте панель управления для визуализации вашей домашней лаборатории на основе SSH-подключений с поддержкой статусов

# Запланированные функции

Смотрите [Проекты](https://github.com/orgs/Termix-SSH/projects/2) для просмотра всех запланированных функций. Если вы хотите внести вклад, смотрите [Участие в разработке](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Установка

Поддерживаемые устройства:

- Веб-сайт (любой современный браузер на любой платформе, включая Chrome, Safari и Firefox) (включая поддержку PWA)
- Windows (x64/ia32)
  - Портативная версия
  - Установщик MSI
  - Менеджер пакетов Chocolatey
- Linux (x64/ia32)
  - Портативная версия
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32, версия 12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (версия 15.1+)
  - Apple App Store
  - ISO
- Android (версия 7.0+)
  - Google Play Store
  - APK

Посетите [документацию](https://docs.termix.site/install) Termix для получения дополнительной информации об установке Termix на всех платформах. Также вы можете ознакомиться с примером файла Docker Compose здесь:

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

# Спонсоры

<p align="left">
  <a href="https://www.digitalocean.com/">
    <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="50" alt="DigitalOcean">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://crowdin.com/">
    <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="50" alt="Crowdin">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.blacksmith.sh/">
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Crowdin">
  </a>
</p>

# Поддержка

Если вам нужна помощь или вы хотите запросить новую функцию для Termix, посетите страницу [Проблемы](https://github.com/Termix-SSH/Support/issues), войдите в систему и нажмите `New Issue`.
Пожалуйста, опишите вашу проблему как можно подробнее, предпочтительно на английском языке. Вы также можете присоединиться к серверу [Discord](https://discord.gg/jVQGdvHDrf) и обратиться в канал поддержки, однако время ответа может быть дольше.

# Скриншоты

[![YouTube](./repo-images/YouTube.png)](https://youtu.be/8OYCPwS7ciA)

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
  <img src="./repo-images/Image 8.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="./repo-images/Image 9.png" width="400" alt="Termix Demo 9"/>
  <img src="./repo-images/Image 10.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="./repo-images/Image 11.png" width="400" alt="Termix Demo 11"/>
  <img src="./repo-images/Image 12.png" width="400" alt="Termix Demo 12"/>
</p>

Некоторые видео и изображения могут быть устаревшими или не полностью отражать функциональность.

# Лицензия

Распространяется по лицензии Apache License Version 2.0. Подробнее см. в файле LICENSE.
