<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestione SSH self-hosted e accesso al desktop remoto</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
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
  Italiano
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
  <sub>Ottenuto il 1 settembre 2025</sub>
</p>

</div>

<br />

## Panoramica

Termix e una piattaforma di gestione server tutto-in-uno, open-source, per sempre gratuita e self-hosted. Fornisce una soluzione multipiattaforma per gestire i tuoi server e la tua infrastruttura attraverso un'unica interfaccia intuitiva. Termix offre accesso al terminale SSH, controllo remoto del desktop (RDP, VNC, Telnet), funzionalita di tunneling SSH, gestione remota dei file SSH e molti altri strumenti. Termix e la perfetta alternativa gratuita e self-hosted a Termius, disponibile per tutte le piattaforme.

<br />

## Funzionalita

<table>
<tr>
<td width="50%" valign="top">

**Accesso Terminale SSH:**
Terminale completo con supporto schermo diviso (fino a 4 pannelli) con un sistema di schede in stile browser. Include il supporto per la personalizzazione del terminale, inclusi temi, font e altri componenti comuni.

</td>
<td width="50%" valign="top">

**Accesso Desktop Remoto:**
Supporto RDP, VNC e Telnet tramite browser con personalizzazione completa e schermo diviso.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gestione Tunnel SSH:**
Crea e gestisci tunnel SSH da server a server con riconnessione automatica, monitoraggio dello stato e inoltro locale, remoto o SOCKS dinamico. Le impostazioni del tunnel da client desktop a server sono archiviate localmente per ogni installazione desktop; gli snapshot di preset C2S opzionali possono essere salvati sul server, rinominati, caricati o eliminati per spostare una configurazione di tunnel locale tra i client.

</td>
<td width="50%" valign="top">

**Gestore File Remoto:**
Gestisci i file direttamente sui server remoti con supporto per la visualizzazione e la modifica di codice, immagini, audio e video. Carica, scarica, rinomina, elimina e sposta file senza problemi con supporto sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gestione Docker:**
Avvia, ferma, metti in pausa, rimuovi container. Visualizza le statistiche dei container. Controlla i container tramite terminale docker exec. Non e stato creato per sostituire Portainer o Dockge, ma piuttosto per gestire semplicemente i tuoi container rispetto alla loro creazione.

</td>
<td width="50%" valign="top">

**Gestore Host SSH:**
Salva, organizza e gestisci le tue connessioni SSH con tag e cartelle (con personalizzazione delle cartelle e supporto per cartelle annidate), salva facilmente le informazioni di accesso riutilizzabili e automatizza il deployment delle chiavi SSH.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Metriche Host:**
Visualizza l'utilizzo di CPU, memoria, disco, rete, uptime, informazioni di sistema, firewall, monitoraggio porte, visualizzatore di log, utenti/permessi, certificati e molto altro sulla maggior parte dei server basati su Linux.

</td>
<td width="50%" valign="top">

**Autenticazione Utente:**
Gestione utenti sicura con controlli amministrativi e supporto OIDC/LDAP/SSO (con controllo degli accessi) e 2FA (TOTP). Visualizza le sessioni utente attive su tutte le piattaforme e revoca i permessi. Collega i tuoi account OIDC/Locali tra loro. Visualizza il log di controllo delle azioni di tutti gli utenti.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Crea ruoli e condividi host tra utenti/ruoli.

</td>
<td width="50%" valign="top">

**Crittografia Database:**
Il backend e archiviato come file di database SQLite crittografati. Consulta la [documentazione](https://docs.termix.site/security) per maggiori informazioni.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Grafico di Rete:**
Personalizza la tua Dashboard per visualizzare il tuo homelab basato sulle connessioni SSH con supporto dello stato.

</td>
<td width="50%" valign="top">

**Strumenti SSH:**
Crea snippet di comandi riutilizzabili che si eseguono con un singolo clic. Esegui un comando simultaneamente su piu terminali aperti.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Schede Persistenti:**
Le sessioni SSH e le schede rimangono aperte tra dispositivi/aggiornamenti se abilitato nel profilo utente.

</td>
<td width="50%" valign="top">

**Lingue:**
Supporto integrato per circa 30 lingue (gestito da [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Altre funzionalita</b></summary>
<br />

- **Dashboard** - Visualizza le informazioni del server a colpo d'occhio sulla tua dashboard
- **Chiavi API** - Crea chiavi API con ambito utente e date di scadenza da utilizzare per automazione/CI
- **Esportazione/Importazione Dati** - Esporta e importa host SSH, credenziali e dati del gestore file
- **Configurazione SSL Automatica** - Generazione e gestione integrata dei certificati SSL con reindirizzamenti HTTPS
- **Interfaccia Moderna** - Interfaccia pulita e responsive per desktop/mobile costruita con React, Tailwind CSS e Shadcn. Scegli tra molti temi UI diversi, inclusi chiaro, scuro, Dracula, ecc. Usa i percorsi URL per aprire qualsiasi connessione a schermo intero.
- **Cronologia Comandi** - Autocompletamento e visualizzazione dei comandi SSH eseguiti in precedenza
- **Connessione Rapida** - Connettiti a un server senza dover salvare i dati di connessione
- **Palette Comandi** - Premi due volte shift sinistro per accedere rapidamente alle connessioni SSH con la tastiera
- **Integrazione Proxmox** - Aggiungi automaticamente host a Termix dalla tua istanza Proxmox
- **SSH Ricco di Funzionalita** - Supporta jump host, Warpgate, connessioni basate su TOTP, SOCKS5, verifica chiave host, compilazione automatica password, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, registrazione terminale, ecc.

</details>

<br />

## Supporto Piattaforme

<table align="center">
<tr>
<th align="center">Piattaforma</th>
<th align="center">Distribuzione</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Qualsiasi browser moderno (Chrome, Safari, Firefox) · Supporto PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · MSI Installer · Chocolatey</td>
</tr>
<tr>
<td align="center"><b>Linux</b> <sub>x64/ia32</sub></td>
<td>Portable · AUR · AppImage · Deb · Flatpak</td>
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

## Installazione

Visita la [Documentazione](https://docs.termix.site/install) di Termix per maggiori informazioni su come installare Termix su tutte le piattaforme. In alternativa, visualizza un file Docker Compose di esempio qui (puoi omettere guacd e la rete se non prevedi di utilizzare le funzioni di desktop remoto):

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

## Screenshot

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Guarda le panoramiche degli aggiornamenti su YouTube</sub>

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

<sub>Alcuni video e immagini potrebbero non essere aggiornati o potrebbero non mostrare perfettamente le funzionalita.</sub>

</div>

<br />

## Funzionalita Pianificate

Consulta [Progetti](https://github.com/orgs/Termix-SSH/projects/2) per tutte le funzionalita pianificate. Se desideri contribuire, consulta [Contribuire](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Sponsor

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

## Supporto

Se hai bisogno di aiuto o vuoi richiedere una funzionalita per Termix, visita la pagina [Segnalazioni](https://github.com/Termix-SSH/Support/issues), accedi e premi `New Issue`. Per favore, sii il piu dettagliato possibile nella tua segnalazione, preferibilmente scritta in inglese. Puoi anche unirti al server [Discord](https://discord.gg/jVQGdvHDrf) e visitare il canale di supporto, tuttavia i tempi di risposta potrebbero essere piu lunghi.

<br />

## Licenza

Distribuito sotto la Licenza Apache Versione 2.0. Consulta `LICENSE` per maggiori informazioni.
