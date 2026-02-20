# Estatísticas do Repositório

<p align="center">
  <a href="README.md"><img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English</a> ·
  <a href="README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <a href="README-JA.md"><img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語</a> ·
  <a href="README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <a href="README-FR.md"><img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français</a> ·
  <a href="README-DE.md"><img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch</a> ·
  <a href="README-ES.md"><img src="https://flagcdn.com/es.svg" alt="Español" width="24" height="16"> Español</a> ·
  <img src="https://flagcdn.com/br.svg" alt="Português" width="24" height="16"> Português ·
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
  <small style="color: #666;">Conquistado em 1 de setembro de 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

Se desejar, você pode apoiar o projeto aqui!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Visão Geral

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix é uma plataforma de gerenciamento de servidores tudo-em-um, de código aberto, sempre gratuita e auto-hospedada. Ela fornece uma solução multiplataforma para gerenciar seus servidores e infraestrutura através de uma interface única e intuitiva. Termix oferece acesso a terminal SSH, capacidades de tunelamento SSH, gerenciamento remoto de arquivos e muitas outras ferramentas. Termix é a alternativa perfeita, gratuita e auto-hospedada ao Termius, disponível para todas as plataformas.

# Funcionalidades

- **Acesso ao Terminal SSH** - Terminal completo com suporte a tela dividida (até 4 painéis) com um sistema de abas similar ao navegador. Inclui suporte para personalização do terminal incluindo temas comuns de terminal, fontes e outros componentes
- **Gerenciamento de Túneis SSH** - Crie e gerencie túneis SSH com reconexão automática e monitoramento de saúde, com suporte para conexões -l ou -r
- **Gerenciador Remoto de Arquivos** - Gerencie arquivos diretamente em servidores remotos com suporte para visualizar e editar código, imagens, áudio e vídeo. Faça upload, download, renomeie, exclua e mova arquivos facilmente com suporte sudo.
- **Gerenciamento de Docker** - Inicie, pare, pause, remova contêineres. Visualize estatísticas de contêineres. Controle contêineres usando o terminal Docker Exec. Não foi feito para substituir Portainer ou Dockge, mas sim para simplesmente gerenciar seus contêineres em vez de criá-los.
- **Gerenciador de Hosts SSH** - Salve, organize e gerencie suas conexões SSH com tags e pastas, e salve facilmente informações de login reutilizáveis com a capacidade de automatizar a implantação de chaves SSH
- **Estatísticas do Servidor** - Visualize o uso de CPU, memória e disco junto com rede, tempo de atividade, informações do sistema, firewall, monitor de portas na maioria dos servidores baseados em Linux
- **Dashboard** - Visualize informações do servidor de relance no seu dashboard
- **RBAC** - Crie funções e compartilhe hosts entre usuários/funções
- **Autenticação de Usuários** - Gerenciamento seguro de usuários com controles de administrador e suporte para OIDC e 2FA (TOTP). Visualize sessões ativas de usuários em todas as plataformas e revogue permissões. Vincule suas contas OIDC/Locais entre si.
- **Criptografia de Banco de Dados** - Backend armazenado como arquivos de banco de dados SQLite criptografados. Consulte a [documentação](https://docs.termix.site/security) para mais informações.
- **Exportação/Importação de Dados** - Exporte e importe hosts SSH, credenciais e dados do gerenciador de arquivos
- **Configuração Automática de SSL** - Geração e gerenciamento integrado de certificados SSL com redirecionamentos HTTPS
- **Interface Moderna** - Interface limpa compatível com desktop/mobile construída com React, Tailwind CSS e Shadcn. Escolha entre modo escuro ou claro. Use rotas de URL para abrir qualquer conexão em tela cheia.
- **Idiomas** - Suporte integrado para ~30 idiomas (gerenciado pelo [Crowdin](https://docs.termix.site/translations))
- **Suporte a Plataformas** - Disponível como aplicação web, aplicação desktop (Windows, Linux e macOS), PWA e aplicativo dedicado para celular/tablet para iOS e Android.
- **Ferramentas SSH** - Crie trechos de comandos reutilizáveis que são executados com um único clique. Execute um comando simultaneamente em múltiplos terminais abertos.
- **Histórico de Comandos** - Autocompletar e visualizar comandos SSH executados anteriormente
- **Conexão Rápida** - Conecte-se a um servidor sem precisar salvar os dados de conexão
- **Paleta de Comandos** - Pressione duas vezes a tecla Shift esquerda para acessar rapidamente as conexões SSH com seu teclado
- **SSH Rico em Funcionalidades** - Suporta jump hosts, Warpgate, conexões baseadas em TOTP, SOCKS5, verificação de chave do host, preenchimento automático de senhas, [OPKSSH](https://github.com/openpubkey/opkssh), etc.
- **Gráfico de Rede** - Personalize seu Dashboard para visualizar seu homelab baseado nas suas conexões SSH com suporte de status

# Funcionalidades Planejadas

Consulte [Projetos](https://github.com/orgs/Termix-SSH/projects/2) para todas as funcionalidades planejadas. Se você deseja contribuir, consulte [Contribuir](https://github.com/Termix-SSH/Termix/blob/main/CONTRIBUTING.md).

# Instalação

Dispositivos suportados:

- Website (qualquer navegador moderno em qualquer plataforma como Chrome, Safari e Firefox) (inclui suporte PWA)
- Windows (x64/ia32)
  - Portátil
  - Instalador MSI
  - Gerenciador de pacotes Chocolatey
- Linux (x64/ia32)
  - Portátil
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 em v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - ISO
- Android (v7.0+)
  - Google Play Store
  - APK

Visite a [documentação](https://docs.termix.site/install) do Termix para mais informações sobre como instalar o Termix em todas as plataformas. Caso contrário, veja um arquivo Docker Compose de exemplo aqui:

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

# Patrocinadores

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

# Suporte

Se você precisa de ajuda ou deseja solicitar uma funcionalidade para o Termix, visite a página de [Issues](https://github.com/Termix-SSH/Support/issues), faça login e clique em `New Issue`.
Por favor, seja o mais detalhado possível no seu relato, preferencialmente escrito em inglês. Você também pode entrar no servidor do [Discord](https://discord.gg/jVQGdvHDrf) e visitar o canal de suporte, porém, os tempos de resposta podem ser mais longos.

# Capturas de Tela

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

Alguns vídeos e imagens podem estar desatualizados ou podem não mostrar perfeitamente as funcionalidades.

# Licença

Distribuído sob a Licença Apache Versão 2.0. Consulte LICENSE para mais informações.
