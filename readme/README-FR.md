# Statistiques du dépôt

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · 🇫🇷 Français · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · <a href="README-PT.md">🇧🇷 Português</a> · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Obtenu le 1er septembre 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Présentation

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix est une plateforme de gestion de serveurs tout-en-un, open source, à jamais gratuite et auto-hébergée. Elle fournit une solution multiplateforme pour gérer vos serveurs et votre infrastructure à travers une interface unique et intuitive. Termix offre un accès terminal SSH, le contrôle de bureau à distance (RDP, VNC, Telnet), des capacités de tunneling SSH, la gestion de fichiers SSH à distance et de nombreux autres outils. Termix est l'alternative parfaite, gratuite et auto-hébergée à Termius, disponible sur toutes les plateformes.

# Fonctionnalités

- **Accès terminal SSH** - Terminal complet avec support d'écran partagé (jusqu'à 4 panneaux) et un système d'onglets inspiré des navigateurs. Inclut la personnalisation du terminal avec des thèmes courants, des polices et d'autres composants.
- **Accès Bureau à Distance** - Support RDP, VNC et Telnet via navigateur avec personnalisation complète et écran partagé.
- **Gestion des tunnels SSH** - Créez et gérez des tunnels SSH de serveur à serveur avec reconnexion automatique, surveillance de l'état et transfert local, distant ou SOCKS dynamique. Les paramètres de tunnel client-bureau-vers-serveur sont stockés localement par installation bureau ; des instantanés de préréglages C2S optionnels peuvent être sauvegardés sur le serveur, renommés, chargés ou supprimés pour déplacer une configuration de tunnel locale entre clients.
- **Gestionnaire de fichiers distant** - Gérez les fichiers directement sur les serveurs distants avec support de la visualisation et de l'édition de code, images, audio et vidéo. Téléversez, téléchargez, renommez, supprimez et déplacez des fichiers de manière fluide avec support sudo.
- **Gestion Docker** - Démarrez, arrêtez, mettez en pause, supprimez des conteneurs. Consultez les statistiques des conteneurs. Contrôlez les conteneurs via le terminal docker exec. Non conçu pour remplacer Portainer ou Dockge, mais plutôt pour gérer simplement vos conteneurs plutôt que de les créer.
- **Gestionnaire d'hôtes SSH** - Enregistrez, organisez et gérez vos connexions SSH avec des tags et des dossiers, et sauvegardez facilement les informations de connexion réutilisables tout en automatisant le déploiement des clés SSH.
- **Statistiques serveur** - Visualisez l'utilisation du CPU, de la mémoire et du disque ainsi que le réseau, le temps de fonctionnement, les informations système, le pare-feu et le moniteur de ports sur la plupart des serveurs Linux.
- **Tableau de bord** - Consultez les informations de vos serveurs en un coup d'œil depuis votre tableau de bord.
- **RBAC** - Créez des rôles et partagez des hôtes entre utilisateurs/rôles.
- **Authentification des utilisateurs** - Gestion sécurisée des utilisateurs avec contrôles administrateur et support OIDC (avec contrôle d'accès) et 2FA (TOTP). Visualisez les sessions utilisateur actives sur toutes les plateformes et révoquez les permissions. Liez vos comptes OIDC/locaux ensemble.
- **Chiffrement de la base de données** - Le backend est stocké sous forme de fichiers de base de données SQLite chiffrés. Consultez la [documentation](https://docs.termix.site/security) pour plus de détails.
- **Clés API** - Créez des clés API à portée utilisateur avec des dates d'expiration pour une utilisation en automatisation/CI.
- **Export/Import de données** - Exportez et importez les hôtes SSH, les identifiants et les données du gestionnaire de fichiers.
- **Configuration SSL automatique** - Génération et gestion intégrées de certificats SSL avec redirections HTTPS.
- **Interface moderne** - Interface épurée compatible desktop/mobile construite avec React, Tailwind CSS et Shadcn. Choisissez parmi de nombreux thèmes d'interface utilisateur, notamment clair, sombre, Dracula, etc. Utilisez les routes URL pour ouvrir n'importe quelle connexion en plein écran.
- **Langues** - Support intégré d'environ 30 langues (géré par [Crowdin](https://docs.termix.site/translations)).
- **Support multiplateforme** - Disponible en tant qu'application web, application de bureau (Windows, Linux et macOS, peut être exécutée de manière autonome sans backend Termix), PWA, et application mobile/tablette dédiée pour iOS et Android.
- **Outils SSH** - Créez des extraits de commandes réutilisables exécutables en un seul clic. Exécutez une commande simultanément sur plusieurs terminaux ouverts.
- **Historique des commandes** - Auto-complétion et consultation des commandes SSH précédemment exécutées.
- **Connexion rapide** - Connectez-vous à un serveur sans avoir à sauvegarder les données de connexion.
- **Palette de commandes** - Appuyez deux fois sur Shift gauche pour accéder rapidement aux connexions SSH avec votre clavier.
- **SSH riche en fonctionnalités** - Support des hôtes de rebond, Warpgate, connexions basées sur TOTP, SOCKS5, vérification des clés d'hôte, remplissage automatique des mots de passe, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, etc.
- **Graphe réseau** - Personnalisez votre tableau de bord pour visualiser votre homelab basé sur vos connexions SSH avec support des statuts.
- **Onglets Persistants** - Les sessions SSH et les onglets restent ouverts sur tous les appareils/actualisations si activé dans le profil utilisateur.

# Fonctionnalités prévues

Consultez les [Projects](https://github.com/orgs/Termix-SSH/projects/2) pour toutes les fonctionnalités prévues. Si vous souhaitez contribuer, consultez [Contributing](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Installation

Appareils supportés :

- Site web (tout navigateur moderne sur toute plateforme comme Chrome, Safari et Firefox) (support PWA inclus)
- Windows (x64/ia32)
  - Portable
  - Installateur MSI
  - Gestionnaire de paquets Chocolatey
- Linux (x64/ia32)
  - Portable
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 sur v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Visitez la [documentation](https://docs.termix.site/install) de Termix pour plus d'informations sur l'installation de Termix sur toutes les plateformes. Sinon, voici un exemple de fichier Docker Compose (vous pouvez omettre guacd et le réseau si vous ne prévoyez pas d'utiliser les fonctionnalités de bureau à distance) :

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

# Sponsors

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

# Support

Si vous avez besoin d'aide ou souhaitez demander une fonctionnalité pour Termix, visitez la page [Issues](https://github.com/Termix-SSH/Support/issues), connectez-vous et appuyez sur `New Issue`. Veuillez être aussi détaillé que possible dans votre issue, de préférence rédigée en anglais. Vous pouvez également rejoindre le serveur [Discord](https://discord.gg/jVQGdvHDrf) et visiter le canal de support, cependant les temps de réponse peuvent être plus longs.

# Captures d'écran

[![YouTube](../repo-images/YouTube.jpg)](https://www.youtube.com/@TermixSSH/videos)

<p align="center">
  <img src="../repo-images/Image%201.png" width="400" alt="Termix Demo 1"/>
  <img src="../repo-images/Image%202.png" width="400" alt="Termix Demo 2"/>
</p>

<p align="center">
  <img src="../repo-images/Image%203.png" width="400" alt="Termix Demo 3"/>
  <img src="../repo-images/Image%204.png" width="400" alt="Termix Demo 4"/>
</p>

<p align="center">
  <img src="../repo-images/Image%205.png" width="400" alt="Termix Demo 5"/>
  <img src="../repo-images/Image%206.png" width="400" alt="Termix Demo 6"/>
</p>

<p align="center">
  <img src="../repo-images/Image%207.png" width="400" alt="Termix Demo 7"/>
  <img src="../repo-images/Image%208.png" width="400" alt="Termix Demo 8"/>
</p>

<p align="center">
  <img src="../repo-images/Image%209.png" width="400" alt="Termix Demo 9"/>
  <img src="../repo-images/Image%2010.png" width="400" alt="Termix Demo 10"/>
</p>

<p align="center">
  <img src="../repo-images/Image%2011.png" width="400" alt="Termix Demo 11"/>
  <img src="../repo-images/Image%2012.png" width="400" alt="Termix Demo 12"/>
</p>

Certaines vidéos et images peuvent être obsolètes ou ne pas présenter parfaitement les fonctionnalités.

# Licence

Distribué sous la licence Apache Version 2.0. Consultez LICENSE pour plus d'informations.
