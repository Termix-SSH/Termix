<div align="center">

<img src="../public/icon.svg" width="120" height="120" alt="Termix Logo" />

<h1>Termix</h1>

<p>Gestion SSH auto-hebergee et acces bureau a distance</p>

<p>
  <a href="../README.md">English</a> ·
  <a href="README-CN.md">中文</a> ·
  <a href="README-JA.md">日本語</a> ·
  <a href="README-KO.md">한국어</a> ·
  Français ·
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
  <sub>Obtenu le 1er septembre 2025</sub>
</p>

</div>

<br />

## Presentation

Termix est une plateforme de gestion de serveurs tout-en-un, open source, a jamais gratuite et auto-hebergee. Elle fournit une solution multiplateforme pour gerer vos serveurs et votre infrastructure a travers une interface unique et intuitive. Termix offre un acces terminal SSH, le controle de bureau a distance (RDP, VNC, Telnet), des capacites de tunneling SSH, la gestion de fichiers SSH a distance et de nombreux autres outils. Termix est l'alternative parfaite, gratuite et auto-hebergee a Termius, disponible sur toutes les plateformes.

<br />

## Fonctionnalites

<table>
<tr>
<td width="50%" valign="top">

**Acces terminal SSH:**
Terminal complet avec support d'ecran partage (jusqu'a 4 panneaux) et un systeme d'onglets inspire des navigateurs. Inclut la personnalisation du terminal avec des themes courants, des polices et d'autres composants.

</td>
<td width="50%" valign="top">

**Acces Bureau a Distance:**
Support RDP, VNC et Telnet via navigateur avec personnalisation complete et ecran partage.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gestion des tunnels SSH:**
Creez et gerez des tunnels SSH de serveur a serveur avec reconnexion automatique, surveillance de l'etat et transfert local, distant ou SOCKS dynamique. Les parametres de tunnel client-bureau-vers-serveur sont stockes localement par installation bureau ; des instantanes de prereglages C2S optionnels peuvent etre sauvegardes sur le serveur, renommes, charges ou supprimes pour deplacer une configuration de tunnel locale entre clients.

</td>
<td width="50%" valign="top">

**Gestionnaire de fichiers distant:**
Gerez les fichiers directement sur les serveurs distants avec support de la visualisation et de l'edition de code, images, audio et video. Televersez, telechargez, renommez, supprimez et deplacez des fichiers de maniere fluide avec support sudo.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Gestion Docker:**
Demarrez, arretez, mettez en pause, supprimez des conteneurs. Consultez les statistiques des conteneurs. Controlez les conteneurs via le terminal docker exec. Non concu pour remplacer Portainer ou Dockge, mais plutot pour gerer simplement vos conteneurs plutot que de les creer.

</td>
<td width="50%" valign="top">

**Gestionnaire d'hotes SSH:**
Enregistrez, organisez et gerez vos connexions SSH avec des tags et des dossiers (personnalisation des dossiers et prise en charge des dossiers imbriques), et sauvegardez facilement les informations de connexion reutilisables tout en automatisant le deploiement des cles SSH.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Metriques d'hote:**
Visualisez l'utilisation du CPU, de la memoire, du disque, le reseau, le temps de fonctionnement, les informations systeme, le pare-feu, le moniteur de ports, le visualiseur de journaux, les utilisateurs/permissions, les certificats et bien plus encore sur la plupart des serveurs Linux.

</td>
<td width="50%" valign="top">

**Authentification des utilisateurs:**
Gestion securisee des utilisateurs avec controles administrateur et support OIDC/LDAP/SSO (avec controle d'acces) et 2FA (TOTP). Visualisez les sessions utilisateur actives sur toutes les plateformes et revoquez les permissions. Liez vos comptes OIDC/locaux ensemble. Consultez le journal d'audit des actions de tous les utilisateurs.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**RBAC:**
Creez des roles et partagez des hotes entre utilisateurs/roles.

</td>
<td width="50%" valign="top">

**Chiffrement de la base de donnees:**
Le backend est stocke sous forme de fichiers de base de donnees SQLite chiffres. Consultez la [documentation](https://docs.termix.site/security) pour plus de details.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Graphe reseau:**
Personnalisez votre tableau de bord pour visualiser votre homelab base sur vos connexions SSH avec support des statuts.

</td>
<td width="50%" valign="top">

**Outils SSH:**
Creez des extraits de commandes reutilisables executables en un seul clic. Executez une commande simultanement sur plusieurs terminaux ouverts.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Onglets Persistants:**
Les sessions SSH et les onglets restent ouverts sur tous les appareils/actualisations si active dans le profil utilisateur.

</td>
<td width="50%" valign="top">

**Langues:**
Support integre d'environ 30 langues (gere par [Crowdin](https://docs.termix.site/translations)).

</td>
</tr>
</table>

<br />

<details>
<summary><b>Plus de fonctionnalites</b></summary>
<br />

- **Tableau de bord** - Consultez les informations de vos serveurs en un coup d'oeil depuis votre tableau de bord
- **Cles API** - Creez des cles API a portee utilisateur avec des dates d'expiration pour une utilisation en automatisation/CI
- **Export/Import de donnees** - Exportez et importez les hotes SSH, les identifiants et les donnees du gestionnaire de fichiers
- **Configuration SSL automatique** - Generation et gestion integrees de certificats SSL avec redirections HTTPS
- **Interface moderne** - Interface epuree compatible desktop/mobile construite avec React, Tailwind CSS et Shadcn. Choisissez parmi de nombreux themes d'interface utilisateur, notamment clair, sombre, Dracula, etc. Utilisez les routes URL pour ouvrir n'importe quelle connexion en plein ecran.
- **Historique des commandes** - Auto-completion et consultation des commandes SSH precedemment executees
- **Connexion rapide** - Connectez-vous a un serveur sans avoir a sauvegarder les donnees de connexion
- **Palette de commandes** - Appuyez deux fois sur Shift gauche pour acceder rapidement aux connexions SSH avec votre clavier
- **Integration Proxmox** - Ajoutez automatiquement des hotes dans Termix depuis votre instance Proxmox
- **SSH riche en fonctionnalites** - Support des hotes de rebond, Warpgate, connexions basees sur TOTP, SOCKS5, verification des cles d'hote, remplissage automatique des mots de passe, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, journalisation du terminal, etc.

</details>

<br />

## Support des plateformes

<table align="center">
<tr>
<th align="center">Plateforme</th>
<th align="center">Distribution</th>
</tr>
<tr>
<td align="center"><b>Web</b></td>
<td>Tout navigateur moderne (Chrome, Safari, Firefox) · Support PWA</td>
</tr>
<tr>
<td align="center"><b>Windows</b> <sub>x64/ia32</sub></td>
<td>Portable · MSI Installateur · Chocolatey</td>
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

## Installation

Visitez la [documentation](https://docs.termix.site/install) de Termix pour plus d'informations sur l'installation de Termix sur toutes les plateformes. Voici un exemple de fichier Docker Compose (vous pouvez omettre guacd et le reseau si vous ne prevoyez pas d'utiliser les fonctionnalites de bureau a distance) :

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

## Faire un don

Termix est gratuit et open source sans abonnements ni plans payants. Si vous le trouvez utile, pensez à faire un don pour aider à couvrir les coûts de serveur, les noms de domaine et le temps de développement.

[Faire un don](https://donate.termix.site/)

<br />

## Captures d'ecran

<div align="center">

<br />

[![YouTube](../repo-images/YouTube.png)](https://www.youtube.com/@TermixSSH/videos)

<sub>Regarder les aperçus des mises a jour sur YouTube</sub>

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

<sub>Certaines videos et images peuvent etre obsoletes ou ne pas presenter parfaitement les fonctionnalites.</sub>

</div>

<br />

## Fonctionnalites prevues

Consultez les [Projects](https://github.com/orgs/Termix-SSH/projects/2) pour toutes les fonctionnalites prevues. Si vous souhaitez contribuer, consultez [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

<br />

## Sponsors

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

## Support

Si vous avez besoin d'aide ou souhaitez demander une fonctionnalite pour Termix, visitez la page [Issues](https://github.com/Termix-SSH/Support/issues), connectez-vous et appuyez sur `New Issue`. Veuillez etre aussi detaille que possible dans votre issue, de preference redigee en anglais. Vous pouvez egalement rejoindre le serveur [Discord](https://discord.gg/jVQGdvHDrf) et visiter le canal de support, cependant les temps de reponse peuvent etre plus longs.

<br />

## Licence

Distribue sous la licence Apache Version 2.0. Consultez `LICENSE` pour plus d'informations.
