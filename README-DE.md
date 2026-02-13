# Repo-Statistiken

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English</a> ·
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <a href="README-JA.md"><img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語</a> ·
  <a href="README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <a href="README-FR.md"><img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français</a> ·
  <img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch ·
  <a href="README-ES.md"><img src="https://flagcdn.com/es.svg" alt="Español" width="24" height="16"> Español</a> ·
  <a href="README-PT.md"><img src="https://flagcdn.com/br.svg" alt="Português" width="24" height="16"> Português</a> ·
  <a href="README-RU.md"><img src="https://flagcdn.com/ru.svg" alt="Русский" width="24" height="16"> Русский</a> ·
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
  <small style="color: #666;">Erreicht am 1. September 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

Wenn Sie möchten, können Sie das Projekt hier unterstützen!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Überblick

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix ist eine quelloffene, dauerhaft kostenlose, selbst gehostete All-in-One-Serververwaltungsplattform. Sie bietet eine plattformübergreifende Lösung zur Verwaltung Ihrer Server und Infrastruktur über eine einzige, intuitive Oberfläche. Termix bietet SSH-Terminalzugriff, SSH-Tunneling-Funktionen, Remote-Dateiverwaltung und viele weitere Werkzeuge. Termix ist die perfekte kostenlose und selbst gehostete Alternative zu Termius, verfügbar für alle Plattformen.

# Funktionen

- **SSH-Terminalzugriff** - Voll ausgestattetes Terminal mit Split-Screen-Unterstützung (bis zu 4 Panels) mit einem browserähnlichen Tab-System. Enthält Unterstützung für die Anpassung des Terminals einschließlich gängiger Terminal-Themes, Schriftarten und anderer Komponenten
- **SSH-Tunnelverwaltung** - Erstellen und verwalten Sie SSH-Tunnel mit automatischer Wiederverbindung und Gesundheitsüberwachung sowie Unterstützung für -l oder -r Verbindungen
- **Remote-Dateimanager** - Verwalten Sie Dateien direkt auf Remote-Servern mit Unterstützung für das Anzeigen und Bearbeiten von Code, Bildern, Audio und Video. Laden Sie Dateien hoch, herunter, benennen Sie sie um, löschen oder verschieben Sie sie nahtlos mit Sudo-Unterstützung.
- **Docker-Verwaltung** - Container starten, stoppen, pausieren, entfernen. Container-Statistiken anzeigen. Container über Docker-Exec-Terminal steuern. Es wurde nicht entwickelt, um Portainer oder Dockge zu ersetzen, sondern um Ihre Container einfach zu verwalten, anstatt sie zu erstellen.
- **SSH-Host-Manager** - Speichern, organisieren und verwalten Sie Ihre SSH-Verbindungen mit Tags und Ordnern und speichern Sie einfach wiederverwendbare Anmeldeinformationen mit der Möglichkeit, die Bereitstellung von SSH-Schlüsseln zu automatisieren
- **Serverstatistiken** - CPU-, Arbeitsspeicher- und Festplattenauslastung sowie Netzwerk, Betriebszeit, Systeminformationen, Firewall, Port-Monitor auf den meisten Linux-basierten Servern anzeigen
- **Dashboard** - Serverinformationen auf einen Blick auf Ihrem Dashboard anzeigen
- **RBAC** - Rollen erstellen und Hosts über Benutzer/Rollen teilen
- **Benutzerauthentifizierung** - Sichere Benutzerverwaltung mit Admin-Kontrollen und OIDC- sowie 2FA (TOTP)-Unterstützung. Aktive Benutzersitzungen über alle Plattformen anzeigen und Berechtigungen widerrufen. OIDC-/Lokale Konten miteinander verknüpfen.
- **Datenbankverschlüsselung** - Backend gespeichert als verschlüsselte SQLite-Datenbankdateien. Weitere Informationen in der [Dokumentation](https://docs.termix.site/security).
- **Datenexport/-import** - SSH-Hosts, Anmeldeinformationen und Dateimanager-Daten exportieren und importieren
- **Automatische SSL-Einrichtung** - Integrierte SSL-Zertifikatsgenerierung und -verwaltung mit HTTPS-Weiterleitungen
- **Moderne Benutzeroberfläche** - Saubere desktop-/mobilfreundliche Oberfläche, erstellt mit React, Tailwind CSS und Shadcn. Wählen Sie zwischen dunklem oder hellem Modus. Verwenden Sie URL-Routen, um jede Verbindung im Vollbildmodus zu öffnen.
- **Sprachen** - Integrierte Unterstützung für ~30 Sprachen (verwaltet über [Crowdin](https://docs.termix.site/translations))
- **Plattformunterstützung** - Verfügbar als Web-App, Desktop-Anwendung (Windows, Linux und macOS), PWA und dedizierte Mobil-/Tablet-App für iOS und Android.
- **SSH-Werkzeuge** - Erstellen Sie wiederverwendbare Befehlsvorlagen, die mit einem einzigen Klick ausgeführt werden. Führen Sie einen Befehl gleichzeitig in mehreren geöffneten Terminals aus.
- **Befehlsverlauf** - Autovervollständigung und Anzeige zuvor ausgeführter SSH-Befehle
- **Schnellverbindung** - Verbinden Sie sich mit einem Server, ohne die Verbindungsdaten speichern zu müssen
- **Befehlspalette** - Doppeltippen Sie die linke Umschalttaste, um schnell auf SSH-Verbindungen mit Ihrer Tastatur zuzugreifen
- **SSH-Funktionsreich** - Unterstützt Jump-Hosts, Warpgate, TOTP-basierte Verbindungen, SOCKS5, Host-Key-Verifizierung, automatisches Ausfüllen von Passwörtern, [OPKSSH](https://github.com/openpubkey/opkssh) usw.
- **Netzwerkgraph** - Passen Sie Ihr Dashboard an, um Ihr Homelab basierend auf Ihren SSH-Verbindungen mit Statusunterstützung zu visualisieren

# Geplante Funktionen

Siehe [Projekte](https://github.com/orgs/Termix-SSH/projects/2) für alle geplanten Funktionen. Wenn Sie beitragen möchten, siehe [Mitwirken](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Installation

Unterstützte Geräte:

- Website (jeder moderne Browser auf jeder Plattform wie Chrome, Safari und Firefox) (einschließlich PWA-Unterstützung)
- Windows (x64/ia32)
  - Portabel
  - MSI-Installationsprogramm
  - Chocolatey-Paketmanager
- Linux (x64/ia32)
  - Portabel
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 ab v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - ISO
- Android (v7.0+)
  - Google Play Store
  - APK

Besuchen Sie die Termix-[Dokumentation](https://docs.termix.site/install) für weitere Informationen zur Installation von Termix auf allen Plattformen. Alternativ finden Sie hier eine Docker Compose-Beispieldatei:

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

# Sponsoren

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

# Support

Wenn Sie Hilfe benötigen oder eine Funktion für Termix anfragen möchten, besuchen Sie die [Issues](https://github.com/Termix-SSH/Support/issues)-Seite, melden Sie sich an und klicken Sie auf `New Issue`.
Bitte beschreiben Sie Ihr Anliegen so detailliert wie möglich, vorzugsweise auf Englisch. Sie können auch dem [Discord](https://discord.gg/jVQGdvHDrf)-Server beitreten und den Support-Kanal besuchen, allerdings können die Antwortzeiten dort länger sein.

# Screenshots

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

Einige Videos und Bilder können veraltet sein oder Funktionen möglicherweise nicht perfekt darstellen.

# Lizenz

Verteilt unter der Apache License Version 2.0. Siehe LICENSE für weitere Informationen.
