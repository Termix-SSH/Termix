<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Selbst gehostete Serververwaltung, von SSH und Remotedesktop bis zu Automatisierungen</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  <a href="README-FR.md">Français</a> ·
  Deutsch ·
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

Termix ist kostenlos und quelloffen. Wenn es dir hilft, denk über eine [Spende](https://donate.termix.site/) nach, um Serverkosten und Entwicklungszeit zu decken.

<br />

<img src="../repo-images/Termix Header.png" alt="Termix Banner" width="900" />

<br />
<br />

<p>
  <img src="../repo-images/Repo of the Day.png" alt="Repo of the Day Achievement" width="280" />
  <br />
  <sub>Erreicht am 1. September 2025</sub>
</p>

</div>

<br />

## Überblick

Termix ist eine kostenlose, quelloffene und selbst gehostete Plattform zur Verwaltung deiner Server. Sie bringt SSH-Terminals, Remotedesktops (RDP, VNC, Telnet), Dateiübertragungen, Tunnel, Docker, Metriken und Automatisierungen an einem Ort zusammen, im Browser, auf dem Desktop und auf dem Handy. Eine selbst gehostete Alternative zu Termius, die dauerhaft kostenlos bleibt.

<br />

## Funktionen

<table>
<tr>
<td width="50%" valign="top">

**SSH-Terminal:**
Ein vollwertiges Terminal mit Tabs wie im Browser und geteiltem Bildschirm, bis zu 6 Bereiche gleichzeitig. Thema, Schrift und Farben wählst du selbst. Über jeder Sitzung sitzt eine Leiste mit CPU, Speicher und Festplatte in Echtzeit sowie Verknüpfungen zu Dateien, Docker, Tunneln und Metriken dieses Hosts.

</td>
<td width="50%" valign="top">

**Remotedesktop:**
RDP, VNC und Telnet im Browser, in Tabs und geteiltem Bildschirm wie jede andere Sitzung. Mit Dateibrowser für RDP-Laufwerke und Hochladen per Drag-and-drop. Auf dem Windows-Desktop kannst du einen Host auch im nativen RDP-Client öffnen.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**SSH-Tunnel:**
Lokale, entfernte und dynamische SOCKS-Weiterleitung mit automatischem Neuverbinden und Statusprüfungen. Client-zu-Server-Tunnel der Desktop-App bleiben auf diesem Rechner, und du kannst Voreinstellungen auf dem Server speichern, um eine Konfiguration auf einen anderen Rechner zu übernehmen.

</td>
<td width="50%" valign="top">

**Dateimanager:**
Dateien über SFTP durchsuchen, bearbeiten, hochladen, herunterladen, umbenennen, verschieben und löschen, auch mit sudo. Code, Bilder, Audio und Video ansehen und bearbeiten. Dateien direkt von einem Server zum anderen kopieren, wobei der schnellste Weg für dich gewählt und die Übertragung auf Fehler geprüft wird.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Docker und Podman:**
Container starten, stoppen, pausieren und entfernen, ihre Auslastung ansehen und eine Shell darin öffnen. Funktioniert mit Docker und mit Podman. Es soll Portainer oder Dockge nicht ersetzen, sondern nur die Container verwalten, die du schon hast.

</td>
<td width="50%" valign="top">

**Hostverwaltung:**
Hosts mit Tags und verschachtelten Ordnern ordnen, die du benennen und einfärben kannst. Gespeicherte Zugangsdaten für mehrere Hosts wiederverwenden, SSH-Schlüssel automatisch verteilen, Hosts unter einem übergeordneten Host gruppieren, in großen Mengen bearbeiten und exportieren. Für einmalige Verbindungen, die du nicht speichern willst, gibt es Schnellverbindung.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Host-Metriken:**
CPU, Speicher, Festplatte, Netzwerk, Temperatur, Laufzeit, Prozesse, Ports, Anmeldungen und Systeminfos auf den meisten Linux-Servern, mit Verlaufsgrafiken. Über Verwaltungskarten kümmerst du dich um Dienste, Cronjobs, Pakete, Benutzer, Firewallregeln, WireGuard, Tailscale, SSL-Zertifikate, Logs und Statusprüfungen, ohne Termix zu verlassen.

</td>
<td width="50%" valign="top">

**Automatisierungen:**
Wähle einen Auslöser und lege fest, was passieren soll. Auslöser sind unter anderem eine Metrik über einem Schwellwert, ein Host der hoch- oder runtergeht, eine geänderte Statusprüfung, ein Zeitplan, ein Container-Ereignis oder ein eingehender Webhook. Schritte können Befehle und Snippets ausführen, Container und Tunnel steuern, einen Host aufwecken, eine URL aufrufen, warten, sich nach einer Bedingung verzweigen, eine andere Automatisierung starten und dich über ntfy, Discord oder einen Webhook benachrichtigen. Mit Testläufen probierst du alles gefahrlos aus.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Flotten:**
Fasse Hosts zu einer Flotte zusammen, entweder von Hand oder über Tag-Regeln, damit neue Hosts von selbst dazukommen. Führe einen Befehl auf allen Hosts gleichzeitig aus, schiebe und hole Dateien auf allen, installiere Pakete und sammle eine Übersicht über Betriebssystem, Kernel, Architektur und Laufzeit.

</td>
<td width="50%" valign="top">

**KI-Assistent:**
Optional und aus, bis du ihn einschaltest. Verbinde OpenAI, Anthropic, Gemini, Ollama oder einen beliebigen OpenAI-kompatiblen Endpunkt und frag ihn zu deiner Umgebung. Er liest Hosts, Flotten, Snippets und Warnungen und schlägt Änderungen vor, die du bestätigst, statt sie selbst vorzunehmen. An Zugangsdaten, Benutzer und Einstellungen kommt er nie heran. Administratoren können ihn für die ganze Instanz auslassen, und du kannst ihn schon bei der Einrichtung ausblenden.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Anmeldung und Benutzer:**
Lokale Konten sowie Anmeldung über OIDC, LDAP, GitHub und Google, dazu Zwei-Faktor-Authentifizierung (TOTP), Passkeys (WebAuthn) und vertrauenswürdige Geräte. Administratoren können Benutzer verwalten, OIDC-Gruppen auf Rollen abbilden, alle aktiven Sitzungen über alle Plattformen hinweg sehen und beenden. Verknüpfe dein lokales Konto mit deinem OIDC-Konto und lies im Prüfprotokoll nach, wer was gemacht hat.

</td>
<td width="50%" valign="top">

**Rollen und Freigaben:**
Lege Rollen an und teile Hosts mit Benutzern oder Rollen auf vier Stufen: Verbinden, Ansehen, Bearbeiten und Verwalten. Das funktioniert mit jeder Authentifizierungsart und jedem Protokoll, und du kannst die Zugangsdaten für einen geteilten Host überschreiben.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Warnungen:**
Lege Regeln für Host-Metriken wie CPU, Speicher und Festplatte fest und lass dich über ntfy, Discord oder einen Webhook benachrichtigen, wenn sie greifen. Sieh dir aktive und wieder behobene Warnungen im Verlauf an und blende aus, was dich nicht interessiert.

</td>
<td width="50%" valign="top">

**Startseite:**
Ein Raster aus Widgets, das du selbst per Drag-and-drop zusammenstellst. Widgets für Hoststatus, Pings, Dienstlinks, Lesezeichen, Suche, Uhren, Kalender, Countdowns, Notizen, RSS, Wetter, Bilder, Iframes, Docker, Tunnel, Metrikdiagramme, eigene APIs und sogar ein laufendes Terminal.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Snippets und Werkzeuge:**
Speichere Befehle, die du oft brauchst, und starte sie mit einem Klick, mit Variablen für den Host und eigene Eingaben. Führe einen Befehl in allen offenen Terminals zugleich aus und durchsuche deinen Befehlsverlauf mit Autovervollständigung.

</td>
<td width="50%" valign="top">

**Sitzungsfreigabe:**
Teile eine laufende Terminal-, RDP-, VNC- oder Telnet-Sitzung in Echtzeit. Verschicke einen Link, dem jeder ohne Konto beitreten kann, oder teile mit einem bestimmten Termix-Benutzer, nur lesend oder mit Schreibrechten. Freigaben können von selbst ablaufen oder zurückgezogen werden und lassen sich global oder pro Host abschalten.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Sitzungsaufzeichnung und Protokolle:**
Zeichne Terminal-, RDP- und VNC-Sitzungen auf und spiel sie später ab. Lade einfache Textprotokolle einer Sitzung herunter und sieh im Verbindungsprotokoll nach, was während einer Verbindung genau passiert ist.

</td>
<td width="50%" valign="top">

**Serielle Verbindungen:**
Sprich mit seriellen Geräten wie Routern, Switches und Mikrocontrollern, aus dem Browser oder der Desktop-App. Stelle Baudrate, Datenbits, Stoppbits und Parität ein. Nutzt die Web-Serial-API in passenden Browsern oder ein natives Backend in der Desktop-App.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Tailscale:**
Hol Geräte aus deinem Tailnet, um sie mit ein paar Klicks als Hosts anzulegen, und verbinde dich per Tailscale SSH, damit deine Tailnet-ACLs den Zugriff regeln und keine Zugangsdaten gespeichert werden. Headscale und eigene Endpunkte gehen auch.

</td>
<td width="50%" valign="top">

**Proxmox:**
Importiere Hosts direkt aus einer Proxmox-Instanz und beobachte Knoten- und Gastwerte wie CPU, Speicher und Storage in einem eigenen Tab.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Arbeitsbereiche und Tabs:**
Speichere eine Reihe von Tabs samt Aufteilung und öffne alles mit einem Klick wieder. Termix merkt sich auch deine letzte Sitzung, sodass deine Tabs nach einem Neuladen und auf anderen Geräten wieder da sind.

</td>
<td width="50%" valign="top">

**Geführte Einrichtung:**
Eine kurze Einrichtung führt dich durch die Wahl einer Oberflächenvorlage, deines Themas, der gewünschten Funktionen und deines ersten Hosts. Der einfache Modus blendet aus, was du nicht nutzt, und du kannst die Einrichtung jederzeit erneut starten oder die Vorlage wechseln.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Desktop eigenständig und Synchronisierung:**
Die Desktop-App läuft eigenständig mit lokalem Backend und eigener Datenbank, ganz ohne Server. Du kannst sie auch mit einem Termix-Server verbinden, um Hosts, Zugangsdaten, Snippets und mehr in beide Richtungen abzugleichen, und wählen, ob Verbindungen lokal oder über den Server aufgebaut werden.

</td>
<td width="50%" valign="top">

**Kommandozeile:**
Ein `termix`-CLI für deine Shell und deine Skripte. Terminals öffnen, einen Befehl auf einem Host oder einer ganzen Flotte ausführen, Dateien per SFTP verschieben und Hosts, Snippets und Zugangsdaten verwalten. Installiere es mit `npm install -g @termix-cli/cli` oder nimm eine eigenständige Binärdatei. Siehe die [CLI-Dokumentation](https://docs.termix.site/cli).

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Sicherheit:**
Passwörter, Schlüssel und andere Geheimnisse werden pro Benutzer verschlüsselt, und die Datenbankdateien selbst lassen sich auf der Festplatte verschlüsseln. Wie das funktioniert, steht in der [Dokumentation](https://docs.termix.site/security).

</td>
<td width="50%" valign="top">

**Sprachen:**
Rund 30 Sprachen sind eingebaut, verwaltet über [Crowdin](https://docs.termix.site/translations).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Weitere Funktionen</b></summary>
<br />

- **Dashboard** - Deine Server auf einen Blick, mit Karten, die du selbst anordnest
- **Netzwerkgrafik** - Dein Homelab aus deinen Hosts gezeichnet, mit Live-Status
- **Tmux-Monitor** - tmux-Sitzungen, Fenster und Bereiche durchsehen, mit Vorschau und Suche
- **API-Schlüssel** - Benutzerbezogene Schlüssel mit Ablaufdatum für Skripte und CI
- **Export und Import** - Hosts, Zugangsdaten und Dateimanager-Daten rein- und rausholen
- **Automatisches SSL** - Zertifikate werden für dich erstellt und erneuert, samt HTTPS-Weiterleitung, oder du bringst eigene mit
- **Datenbanken** - Standardmäßig SQLite, dazu PostgreSQL und MySQL
- **Moderne Oberfläche** - Aufgeräumte React-Oberfläche für Desktop und Handy, mit Themen wie Hell, Dunkel und Dracula. Jede Verbindung lässt sich über eine URL im Vollbild öffnen
- **Befehlspalette** - Zweimal linke Umschalttaste, um per Tastatur zu einem Host zu springen
- **Tastenkürzel** - Zwischen Tabs wechseln, Tabs schließen und mehr, alles neu belegbar
- **Wake-on-LAN** - Einen Rechner aus Termix heraus oder aus einem Automatisierungsschritt aufwecken
- **Vertrauenswürdiger Proxy** - Einen Reverse Proxy die Anmeldung erledigen und den Benutzer durchreichen lassen
- **Viele SSH-Funktionen** - Sprunghosts, Warpgate, TOTP-Abfragen, SOCKS5, Prüfung von Hostschlüsseln, automatisches Ausfüllen von Passwörtern, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, Port Knocking, Terminalprotokolle, Agent-Weiterleitung, Bitwarden SSH-Agent, SSH-Signierung über HashiCorp Vault und mehr
- **Termix ID** - Eine eingebaute Variante von sshid.io. Sichere dir einen Namen, veröffentliche deine öffentlichen Schlüssel unter einer Resolver-URL und stelle SSH-Zertifikate über die eingebaute CA aus

</details>

<br />

## Unterstützte Plattformen

<table align="center">
<tr>
<th align="center">Plattform</th>
<th align="center">Bezugsquelle</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Jeder moderne Browser (Chrome, Safari, Firefox) · PWA-fähig</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portabel · MSI-Installer · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portabel · AUR · AppImage · Deb · Flatpak</td>
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

## Installation

In der [Termix-Dokumentation](https://docs.termix.site/install) findest du die vollständigen Installationsanleitungen für alle Plattformen.

Beispiel für eine Docker-Compose-Datei (`guacd` und das Netzwerk kannst du weglassen, wenn du keinen Remotedesktop brauchst):

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

### Kommandozeile

Termix hat auch ein CLI, damit du deine Server vom Terminal aus verwalten und Termix in eigenen Skripten nutzen kannst.

```bash
npm install -g @termix-cli/cli
termix login --url https://termix.example.com
termix ssh 1
```

Es kann Terminals öffnen, einen Befehl auf einem Host oder einer ganzen Flotte ausführen, Dateien per SFTP verschieben und Hosts, Snippets und Zugangsdaten verwalten. Die vollständige Dokumentation steht auf [docs.termix.site/cli](https://docs.termix.site/cli).

### Cloud-Hosting

Du kannst den Termix-Server auf einem VPS laufen lassen statt im eigenen Netz. Läuft Termix in dem Netz, das es verwaltet, reißt eine Störung es mit sich, und zwar genau dann, wenn du es zum Reparieren bräuchtest. Woanders bleibt es erreichbar, du bekommst eine feste IP und kommst von überall heran, ohne VPN und ohne Portfreigabe.

[GINERNET](https://docs.termix.site/install/ginernet) sponsert Termix, und in der Dokumentation steht eine Schritt-für-Schritt-Anleitung für die Bereitstellung auf deren VPS-Plattform.

<br />

## Telemetrie

Termix schickt einmal am Tag ein kleines anonymes Signal, damit ich sehen kann, wie viele Instanzen laufen und welche Funktionen genutzt werden. Enthalten sind eine zufällige Instanz-ID, wie viele Benutzer und Hosts du hast, die App-Version und welche Funktionen (Terminal, Dateimanager, Tunnel, Docker usw.) in den letzten 24 Stunden benutzt wurden. Niemals enthalten sind Benutzernamen, Hostnamen, IP-Adressen, Zugangsdaten oder irgendetwas anderes, das dich oder deine Server identifiziert.

Es ist standardmäßig an. Schalte es in den Administrationseinstellungen unter Allgemein aus oder setze `ENABLE_TELEMETRY=false`, bevor du Termix überhaupt startest.

<br />

## Spenden

Termix ist kostenlos und quelloffen, ohne Abo und ohne Bezahlmodell. Wenn es dir hilft, denk über eine Spende nach, um Server, Domains und Entwicklungszeit zu decken. Spenden finanzieren auch die Zeit, um Funktionen wie SAML, Kubernetes und Agent-Unterstützung zu erarbeiten. Unten kannst du den Fortschritt verfolgen und spenden.

[Spenden](https://donate.termix.site/)

<br />

## Sponsoren

Interesse an einer bezahlten Platzierung zur Unterstützung der Entwicklung? Schreib an [mail@termix.site](mailto:mail@termix.site).

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

## Support

Brauchst du Hilfe oder möchtest du eine Funktion vorschlagen? Erstelle ein [neues Issue](https://github.com/Termix-SSH/Support/issues) und beschreibe es so genau wie möglich, nach Möglichkeit auf Englisch. Du kannst auch im Support-Kanal auf [Discord](https://discord.gg/jVQGdvHDrf) fragen, dort dauern Antworten aber manchmal länger.

<br />

## Screenshots

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Übersichten zu Updates auf YouTube ansehen</sub>

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

<sub>Manche Videos und Bilder sind vielleicht veraltet oder zeigen die Funktionen nicht perfekt.</sub>

</div>

<br />

## Geplante Funktionen

Alle geplanten Funktionen stehen unter [Projects](https://github.com/orgs/Termix-SSH/projects/5). Wenn du mitarbeiten möchtest, sieh dir [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md) an.

<br />

## Lizenz

Veröffentlicht unter der Apache-Lizenz Version 2.0. Mehr dazu in `LICENSE`.
