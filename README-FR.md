# Statistiques du dépôt

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English</a> ·
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <a href="README-JA.md"><img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語</a> ·
  <a href="README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français ·
  <a href="README-DE.md"><img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch</a> ·
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
  <small style="color: #666;">Obtenu le 1er septembre 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

Si vous le souhaitez, vous pouvez soutenir le projet ici !\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Présentation

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix est une plateforme de gestion de serveurs tout-en-un, open source, à jamais gratuite et auto-hébergée. Elle fournit une solution multiplateforme pour gérer vos serveurs et votre infrastructure à travers une interface unique et intuitive. Termix offre un accès terminal SSH, des capacités de tunneling SSH, la gestion de fichiers à distance, et de nombreux autres outils. Termix est l'alternative parfaite, gratuite et auto-hébergée à Termius, disponible sur toutes les plateformes.

# Fonctionnalités

- **Accès terminal SSH** - Terminal complet avec support d'écran partagé (jusqu'à 4 panneaux) et un système d'onglets inspiré des navigateurs. Inclut la personnalisation du terminal avec des thèmes courants, des polices et d'autres composants
- **Gestion des tunnels SSH** - Créez et gérez des tunnels SSH avec reconnexion automatique et surveillance de l'état, avec support des connexions -l ou -r
- **Gestionnaire de fichiers distant** - Gérez les fichiers directement sur les serveurs distants avec support de la visualisation et de l'édition de code, images, audio et vidéo. Téléversez, téléchargez, renommez, supprimez et déplacez des fichiers de manière fluide avec support sudo
- **Gestion Docker** - Démarrez, arrêtez, mettez en pause, supprimez des conteneurs. Consultez les statistiques des conteneurs. Contrôlez les conteneurs via le terminal docker exec. Non conçu pour remplacer Portainer ou Dockge, mais plutôt pour gérer simplement vos conteneurs plutôt que de les créer
- **Gestionnaire d'hôtes SSH** - Enregistrez, organisez et gérez vos connexions SSH avec des tags et des dossiers, et sauvegardez facilement les informations de connexion réutilisables tout en automatisant le déploiement des clés SSH
- **Statistiques serveur** - Visualisez l'utilisation du CPU, de la mémoire et du disque ainsi que le réseau, le temps de fonctionnement, les informations système, le pare-feu et le moniteur de ports sur la plupart des serveurs Linux
- **Tableau de bord** - Consultez les informations de vos serveurs en un coup d'œil depuis votre tableau de bord
- **RBAC** - Créez des rôles et partagez des hôtes entre utilisateurs/rôles
- **Authentification des utilisateurs** - Gestion sécurisée des utilisateurs avec contrôles administrateur et support OIDC et 2FA (TOTP). Visualisez les sessions utilisateur actives sur toutes les plateformes et révoquez les permissions. Liez vos comptes OIDC/locaux ensemble
- **Chiffrement de la base de données** - Le backend est stocké sous forme de fichiers de base de données SQLite chiffrés. Consultez la [documentation](https://docs.termix.site/security) pour plus de détails
- **Export/Import de données** - Exportez et importez les hôtes SSH, les identifiants et les données du gestionnaire de fichiers
- **Configuration SSL automatique** - Génération et gestion intégrées de certificats SSL avec redirections HTTPS
- **Interface moderne** - Interface épurée compatible desktop/mobile construite avec React, Tailwind CSS et Shadcn. Choisissez entre un thème sombre ou clair. Utilisez les routes URL pour ouvrir n'importe quelle connexion en plein écran
- **Langues** - Support intégré d'environ 30 langues (géré par [Crowdin](https://docs.termix.site/translations))
- **Support multiplateforme** - Disponible en tant qu'application web, application de bureau (Windows, Linux et macOS), PWA, et application mobile/tablette dédiée pour iOS et Android
- **Outils SSH** - Créez des extraits de commandes réutilisables exécutables en un seul clic. Exécutez une commande simultanément sur plusieurs terminaux ouverts
- **Historique des commandes** - Auto-complétion et consultation des commandes SSH précédemment exécutées
- **Connexion rapide** - Connectez-vous à un serveur sans avoir à sauvegarder les données de connexion
- **Palette de commandes** - Appuyez deux fois sur Shift gauche pour accéder rapidement aux connexions SSH avec votre clavier
- **SSH riche en fonctionnalités** - Support des hôtes de rebond, Warpgate, connexions basées sur TOTP, SOCKS5, vérification des clés d'hôte, remplissage automatique des mots de passe, [OPKSSH](https://github.com/openpubkey/opkssh), etc.
- **Graphe réseau** - Personnalisez votre tableau de bord pour visualiser votre homelab basé sur vos connexions SSH avec support des statuts

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
  - ISO
- Android (v7.0+)
  - Google Play Store
  - APK

Visitez la [documentation](https://docs.termix.site/install) de Termix pour plus d'informations sur l'installation de Termix sur toutes les plateformes. Sinon, voici un exemple de fichier Docker Compose :

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
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Crowdin">
  </a>
</p>

# Support

Si vous avez besoin d'aide ou souhaitez demander une fonctionnalité pour Termix, visitez la page [Issues](https://github.com/Termix-SSH/Support/issues), connectez-vous et appuyez sur `New Issue`. Veuillez être aussi détaillé que possible dans votre issue, de préférence rédigée en anglais. Vous pouvez également rejoindre le serveur [Discord](https://discord.gg/jVQGdvHDrf) et visiter le canal de support, cependant les temps de réponse peuvent être plus longs.

# Captures d'écran

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

Certaines vidéos et images peuvent être obsolètes ou ne pas présenter parfaitement les fonctionnalités.

# Licence

Distribué sous la licence Apache Version 2.0. Consultez LICENSE pour plus d'informations.
