# Статистика репозитория

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · 🇷🇺 Русский · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Достигнуто 1 сентября 2025 года</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Обзор

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix — это платформа для управления серверами с открытым исходным кодом, навсегда бесплатная и размещаемая на собственном сервере. Она предоставляет мультиплатформенное решение для управления вашими серверами и инфраструктурой через единый интуитивно понятный интерфейс. Termix предлагает доступ к SSH-терминалу, управление удаленным рабочим столом (RDP, VNC, Telnet), возможности SSH-туннелирования, удаленное управление файлами SSH и множество других инструментов. Termix — это идеальная бесплатная альтернатива Termius с возможностью размещения на собственном сервере, доступная для всех платформ.

# Возможности

- **Доступ к SSH-терминалу** — Полнофункциональный терминал с поддержкой разделения экрана (до 4 панелей) и системой вкладок, как в браузере. Включает поддержку настройки терминала, включая популярные темы, шрифты и другие компоненты.
- **Доступ к удалённому рабочему столу** — Поддержка RDP, VNC и Telnet через браузер с полной настройкой и разделением экрана
- **Управление SSH-туннелями** — Создание и управление межсерверными SSH-туннелями с автоматическим переподключением, мониторингом состояния и локальной, удалённой или динамической SOCKS-переадресацией. Настройки туннелей «десктопный клиент — сервер» хранятся локально для каждой установки; опциональные снимки C2S-пресетов можно сохранять на сервере, переименовывать, загружать или удалять для переноса конфигурации между клиентами.
- **Удалённый файловый менеджер** — Управление файлами непосредственно на удалённых серверах с поддержкой просмотра и редактирования кода, изображений, аудио и видео. Загрузка, скачивание, переименование, удаление и перемещение файлов с поддержкой sudo.
- **Управление Docker** — Запуск, остановка, приостановка, удаление контейнеров. Просмотр статистики контейнеров. Управление контейнером через терминал docker exec. Не предназначен для замены Portainer или Dockge, а скорее для простого управления контейнерами по сравнению с их созданием.
- **Менеджер SSH-хостов** — Сохранение, организация и управление SSH-подключениями с помощью тегов и папок, с возможностью сохранения данных для повторного входа и автоматизации развёртывания SSH-ключей
- **Статистика сервера** — Просмотр использования CPU, памяти и диска, а также сети, времени работы, информации о системе, файрвола и монитора портов на большинстве серверов на базе Linux
- **Панель управления** — Просмотр информации о сервере на панели управления одним взглядом
- **RBAC** — Создание ролей и предоставление общего доступа к хостам для пользователей/ролей
- **Аутентификация пользователей** — Безопасное управление пользователями с административным контролем и поддержкой OIDC (с контролем доступа) и 2FA (TOTP). Просмотр активных сессий пользователей на всех платформах и отзыв прав доступа. Связывание аккаунтов OIDC/локальных аккаунтов.
- **Шифрование базы данных** — Бэкенд хранится в виде зашифрованных файлов базы данных SQLite. Подробнее в [документации](https://docs.termix.site/security)
- **API-ключи** — Создание API-ключей с областью видимости пользователя и сроками действия для использования в автоматизации/CI.
- **Экспорт/импорт данных** — Экспорт и импорт SSH-хостов, учётных данных и данных файлового менеджера
- **Автоматическая настройка SSL** — Встроенная генерация и управление SSL-сертификатами с перенаправлением на HTTPS
- **Современный интерфейс** — Чистый интерфейс для десктопа и мобильных устройств, построенный на React, Tailwind CSS и Shadcn. Выбор между множеством различных тем интерфейса, включая светлую, тёмную, Dracula и т. д. Использование URL-маршрутов для открытия любого подключения в полноэкранном режиме.
- **Языки** — Встроенная поддержка ~30 языков (управляется через [Crowdin](https://docs.termix.site/translations))
- **Поддержка платформ** — Доступен как веб-приложение, настольное приложение (Windows, Linux и macOS, может работать автономно без бэкенда Termix), PWA и специализированное мобильное/планшетное приложение для iOS и Android.
- **Инструменты SSH** — Создание переиспользуемых фрагментов команд, выполняемых одним нажатием. Запуск одной команды одновременно в нескольких открытых терминалах.
- **История команд** — Автодополнение и просмотр ранее выполненных SSH-команд
- **Быстрое подключение** — Подключение к серверу без необходимости сохранения данных подключения
- **Командная палитра** — Двойное нажатие левого Shift для быстрого доступа к SSH-подключениям с клавиатуры
- **Богатый функционал SSH** — Поддержка jump-хостов, Warpgate, подключений на основе TOTP, SOCKS5, верификации ключей хоста, автозаполнения паролей, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking и др.
- **Сетевой граф** — Настройте панель управления для визуализации вашей домашней лаборатории на основе SSH-подключений с поддержкой статусов
- **Постоянные вкладки** — SSH-сессии и вкладки остаются открытыми на всех устройствах/при обновлении страницы, если включено в профиле пользователя

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
  - IPA
- Android (версия 7.0+)
  - Google Play Store
  - APK

Посетите [документацию](https://docs.termix.site/install) Termix для получения дополнительной информации об установке Termix на всех платформах. Также вы можете ознакомиться с примером файла Docker Compose здесь (вы можете опустить guacd и сеть, если не планируете использовать функции удаленного рабочего стола):

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
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Blacksmith">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.cloudflare.com/">
    <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="50" alt="Cloudflare">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://tailscale.com/">
    <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="50" alt="TailScale">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://akamai.com/">
    <img src="https://upload.wikimedia.org/wikipedia/commons/8/8b/Akamai_logo.svg" height="50" alt="Akamai">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://aws.amazon.com/">
    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/960px-Amazon_Web_Services_Logo.svg.png" height="50" alt="AWS">
  </a>
</p>

# Поддержка

Если вам нужна помощь или вы хотите запросить новую функцию для Termix, посетите страницу [Проблемы](https://github.com/Termix-SSH/Support/issues), войдите в систему и нажмите `New Issue`.
Пожалуйста, опишите вашу проблему как можно подробнее, предпочтительно на английском языке. Вы также можете присоединиться к серверу [Discord](https://discord.gg/jVQGdvHDrf) и обратиться в канал поддержки, однако время ответа может быть дольше.

# Скриншоты

[![YouTube](../repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

<p align="center">
  <img src="../repo-images/Image%201.png" width="400" alt="Termix Demo 1"/>
  <img src="../repo-images/Image 2.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="../repo-images/Image 3.png" width="400" alt="Termix Demo 3"/>
  <img src="../repo-images/Image 4.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="../repo-images/Image 5.png" width="400" alt="Termix Demo 5"/>
  <img src="../repo-images/Image 6.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="../repo-images/Image 7.png" width="400" alt="Termix Demo 7"/>
  <img src="../repo-images/Image 8.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="../repo-images/Image 9.png" width="400" alt="Termix Demo 9"/>
  <img src="../repo-images/Image%2010.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="../repo-images/Image%2011.png" width="400" alt="Termix Demo 11"/>
  <img src="../repo-images/Image%2012.png" width="400" alt="Termix Demo 12"/>
</p>

Некоторые видео и изображения могут быть устаревшими или не полностью отражать функциональность.

# Лицензия

Распространяется по лицензии Apache License Version 2.0. Подробнее см. в файле LICENSE.
