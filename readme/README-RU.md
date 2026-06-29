<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Самостоятельно размещаемое управление SSH и доступ к удалённому рабочему столу</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-PT.md">Português</a> ·
  Русский ·
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

<br />

Termix — бесплатный проект с открытым исходным кодом. Если он вам полезен, рассмотрите возможность [пожертвования](https://donate.termix.site/) для покрытия расходов на серверы и время разработки.

<a href="https://donate.termix.site/"><img src="../repo-images/donation-goal.svg" alt="Monthly donation goal" /></a>

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Достигнуто 1 сентября 2025 года</sub>
</p>

</div>

<br />

## Обзор

Termix - это платформа для управления серверами с открытым исходным кодом, навсегда бесплатная и размещаемая на собственном сервере. Она предоставляет мультиплатформенное решение для управления вашими серверами и инфраструктурой через единый интуитивно понятный интерфейс. Termix предлагает доступ к SSH-терминалу, управление удаленным рабочим столом (RDP, VNC, Telnet), возможности SSH-туннелирования, удаленное управление файлами SSH и множество других инструментов. Termix - это идеальная бесплатная альтернатива Termius с возможностью размещения на собственном сервере, доступная для всех платформ.

<br />

## Возможности

<table>
<tr>
<td width="50%" valign="top">

**Доступ к SSH-терминалу:**
Полнофункциональный терминал с поддержкой разделения экрана (до 4 панелей) и системой вкладок, как в браузере. Включает поддержку настройки терминала, включая популярные темы, шрифты и другие компоненты.

</td>
<td width="50%" valign="top">

**Доступ к удалённому рабочему столу:**
Поддержка RDP, VNC и Telnet через браузер с полной настройкой и разделением экрана.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Управление SSH-туннелями:**
Создание и управление межсерверными SSH-туннелями с автоматическим переподключением, мониторингом состояния и локальной, удалённой или динамической SOCKS-переадресацией. Настройки туннелей «десктопный клиент - сервер» хранятся локально для каждой установки; опциональные снимки C2S-пресетов можно сохранять на сервере, переименовывать, загружать или удалять для переноса конфигурации между клиентами.

</td>
<td width="50%" valign="top">

**Удалённый файловый менеджер:**
Управление файлами непосредственно на удалённых серверах с поддержкой просмотра и редактирования кода, изображений, аудио и видео. Загрузка, скачивание, переименование, удаление и перемещение файлов с поддержкой sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Управление Docker и Podman:**
Запуск, остановка, приостановка, удаление контейнеров. Просмотр статистики контейнеров. Управление контейнером через терминал docker exec. Поддерживает как Docker, так и Podman в качестве среды выполнения контейнеров. Не предназначен для замены Portainer или Dockge, а скорее для простого управления контейнерами по сравнению с их созданием.

</td>
<td width="50%" valign="top">

**Менеджер SSH-хостов:**
Сохранение, организация и управление SSH-подключениями с помощью тегов и папок (с настройкой папок и поддержкой вложенных папок), с возможностью сохранения данных для повторного входа и автоматизации развёртывания SSH-ключей.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Метрики хоста:**
Просмотр использования CPU, памяти и диска, сети, времени работы, информации о системе, файрвола, монитора портов, просмотрщика логов, пользователей/прав доступа, сертификатов и многого другого на большинстве серверов на базе Linux.

</td>
<td width="50%" valign="top">

**Аутентификация пользователей:**
Безопасное управление пользователями с административным контролем и поддержкой OIDC/LDAP/SSO (с контролем доступа) и 2FA (TOTP). Просмотр активных сессий пользователей на всех платформах и отзыв прав доступа. Связывание аккаунтов OIDC/локальных аккаунтов. Просмотр журнала аудита действий всех пользователей.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Интеграция с Tailscale:**
Список устройств вашей сети Tailscale для быстрого добавления их в качестве хостов и подключение через Tailscale SSH в качестве метода аутентификации, позволяя ACL вашей сети управлять авторизацией без хранения учётных данных.

</td>
<td width="50%" valign="top">

**RBAC:**
Создание ролей и предоставление общего доступа к хостам для пользователей/ролей.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Последовательные подключения:**
Подключение к последовательным устройствам (маршрутизаторы, коммутаторы, микроконтроллеры и т. д.) напрямую из браузера или приложения для рабочего стола. Настройка скорости передачи данных, битов данных, стоп-битов и чётности. Использует Web Serial API в поддерживаемых браузерах или нативный бэкенд в приложении Electron.

</td>
<td width="50%" valign="top">

**Оповещения:**
Настройте правила оповещений на основе пороговых значений для метрик хоста (CPU, память, диск и т. д.) и получайте уведомления через ntfy или вебхуки при их срабатывании. Просматривайте активные и разрешённые оповещения в журнале истории.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Домашняя страница:**
Полностью настраиваемая домашняя страница с сеткой виджетов с перетаскиванием. Добавляйте виджеты для статуса хоста, ссылок на сервисы, часов, заметок, RSS-лент, погоды, контейнеров Docker, графиков метрик хоста, встроенных терминалов, iframe и многого другого.

</td>
<td width="50%" valign="top">

**Шифрование базы данных:**
Бэкенд хранится в виде зашифрованных файлов базы данных SQLite. Подробнее в [документации](https://docs.termix.site/security).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Сетевой граф:**
Настройте панель управления для визуализации вашей домашней лаборатории на основе SSH-подключений с поддержкой статусов.

</td>
<td width="50%" valign="top">

**Инструменты SSH:**
Создание переиспользуемых фрагментов команд, выполняемых одним нажатием. Запуск одной команды одновременно в нескольких открытых терминалах.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Постоянные вкладки:**
SSH-сессии и вкладки остаются открытыми на всех устройствах/при обновлении страницы, если включено в профиле пользователя.

</td>
<td width="50%" valign="top">

**Языки:**
Встроенная поддержка около 30 языков (управляется через [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Больше возможностей</b></summary>
<br />

- **Панель управления** - Просмотр информации о сервере на панели управления одним взглядом
- **API-ключи** - Создание API-ключей с областью видимости пользователя и сроками действия для использования в автоматизации/CI
- **Экспорт/импорт данных** - Экспорт и импорт SSH-хостов, учётных данных и данных файлового менеджера
- **Автоматическая настройка SSL** - Встроенная генерация и управление SSL-сертификатами с перенаправлением на HTTPS
- **Современный интерфейс** - Чистый интерфейс для десктопа и мобильных устройств, построенный на React, Tailwind CSS и Shadcn. Выбор между множеством различных тем интерфейса, включая светлую, тёмную, Dracula и т. д. Использование URL-маршрутов для открытия любого подключения в полноэкранном режиме.
- **История команд** - Автодополнение и просмотр ранее выполненных SSH-команд
- **Быстрое подключение** - Подключение к серверу без необходимости сохранения данных подключения
- **Командная палитра** - Двойное нажатие левого Shift для быстрого доступа к SSH-подключениям с клавиатуры
- **Интеграция с Proxmox** - Автоматическое добавление хостов в Termix из вашего экземпляра Proxmox
- **Богатый функционал SSH** - Поддержка jump-хостов, Warpgate, подключений на основе TOTP, SOCKS5, верификации ключей хоста, автозаполнения паролей, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, логирования терминала и др.

</details>

<br />

## Поддержка платформ

<table align="center">
<tr>
<th align="center">Платформа</th>
<th align="center">Дистрибутив</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Любой современный браузер (Chrome, Safari, Firefox) · Поддержка PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Портативная версия · Установщик MSI · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Портативная версия · AUR · AppImage · Deb · Flatpak</td>
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

## Установка

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

<br />

## Пожертвование

Termix — бесплатный проект с открытым исходным кодом. Если он вам полезен, рассмотрите возможность [пожертвования](https://donate.termix.site/) для покрытия расходов на серверы и время разработки.

<a href="https://donate.termix.site/"><img src="../repo-images/donation-goal.svg" alt="Monthly donation goal" /></a>

<br />

## Скриншоты

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Смотрите обзоры обновлений на YouTube</sub>

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

<sub>Некоторые видео и изображения могут быть устаревшими или не полностью отражать функциональность.</sub>

</div>

<br />

## Запланированные функции

Смотрите [Проекты](https://github.com/orgs/Termix-SSH/projects/5) для просмотра всех запланированных функций. Если вы хотите внести вклад, смотрите [Участие в разработке](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Спонсоры

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

## Поддержка

Если вам нужна помощь или вы хотите запросить новую функцию для Termix, посетите страницу [Проблемы](https://github.com/Termix-SSH/Support/issues), войдите в систему и нажмите `New Issue`. Пожалуйста, опишите вашу проблему как можно подробнее, предпочтительно на английском языке. Вы также можете присоединиться к серверу [Discord](https://discord.gg/jVQGdvHDrf) и обратиться в канал поддержки, однако время ответа может быть дольше.

<br />

## Лицензия

Распространяется по лицензии Apache License Version 2.0. Подробнее см. в файле `LICENSE`.
