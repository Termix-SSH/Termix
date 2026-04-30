# Estatísticas do Repositório

<p align="center">
<a href="../README.md">🇺🇸 English</a> · <a href="README-CN.md">🇨🇳 中文</a> · <a href="README-JA.md">🇯🇵 日本語</a> · <a href="README-KO.md">🇰🇷 한국어</a> · <a href="README-FR.md">🇫🇷 Français</a> · <a href="README-DE.md">🇩🇪 Deutsch</a> · <a href="README-ES.md">🇪🇸 Español</a> · 🇧🇷 Português · <a href="README-RU.md">🇷🇺 Русский</a> · <a href="README-AR.md">🇸🇦 العربية</a> · <a href="README-HI.md">🇮🇳 हिन्दी</a> · <a href="README-TR.md">🇹🇷 Türkçe</a> · <a href="README-VI.md">🇻🇳 Tiếng Việt</a> · <a href="README-IT.md">🇮🇹 Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/Termix-SSH/Termix?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/Termix-SSH/Termix?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/Termix-SSH/Termix?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="../repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Conquistado em 1 de setembro de 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

# Visão Geral

<p align="center">
  <a href="https://github.com/Termix-SSH/Termix">
    <img alt="Termix Banner" src=../public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

Termix é uma plataforma de gerenciamento de servidores tudo-em-um, de código aberto, sempre gratuita e auto-hospedada. Ela fornece uma solução multiplataforma para gerenciar seus servidores e infraestrutura através de uma interface única e intuitiva. Termix oferece acesso a terminal SSH, controle de desktop remoto (RDP, VNC, Telnet), capacidades de tunelamento SSH, gerenciamento remoto de arquivos SSH e muitas outras ferramentas. Termix é a alternativa perfeita, gratuita e auto-hospedada ao Termius, disponível para todas as plataformas.

# Funcionalidades

- **Acesso ao Terminal SSH** - Terminal completo com suporte a tela dividida (até 4 painéis) com um sistema de abas similar ao navegador. Inclui suporte para personalização do terminal incluindo temas comuns de terminal, fontes e outros componentes.
- **Acesso à Área de Trabalho Remota** - Suporte a RDP, VNC e Telnet pelo navegador com personalização completa e tela dividida
- **Gerenciamento de Túneis SSH** - Crie e gerencie túneis SSH de servidor para servidor com reconexão automática, monitoramento de saúde e encaminhamento local, remoto ou SOCKS dinâmico. As configurações de túnel de cliente desktop para servidor são armazenadas localmente por instalação de desktop; snapshots de predefinições C2S opcionais podem ser salvos no servidor, renomeados, carregados ou excluídos para mover uma configuração de túnel local entre clientes.
- **Gerenciador Remoto de Arquivos** - Gerencie arquivos diretamente em servidores remotos com suporte para visualizar e editar código, imagens, áudio e vídeo. Faça upload, download, renomeie, exclua e mova arquivos facilmente com suporte sudo.
- **Gerenciamento de Docker** - Inicie, pare, pause, remova contêineres. Visualize estatísticas de contêineres. Controle contêineres usando o terminal Docker Exec. Não foi feito para substituir Portainer ou Dockge, mas sim para simplesmente gerenciar seus contêineres em vez de criá-los.
- **Gerenciador de Hosts SSH** - Salve, organize e gerencie suas conexões SSH com tags e pastas, e salve facilmente informações de login reutilizáveis com a capacidade de automatizar a implantação de chaves SSH
- **Estatísticas do Servidor** - Visualize o uso de CPU, memória e disco junto com rede, tempo de atividade, informações do sistema, firewall, monitor de portas na maioria dos servidores baseados em Linux
- **Dashboard** - Visualize informações do servidor de relance no seu dashboard
- **RBAC** - Crie funções e compartilhe hosts entre usuários/funções
- **Autenticação de Usuários** - Gerenciamento seguro de usuários com controles de administrador e suporte para OIDC (com controle de acesso) e 2FA (TOTP). Visualize sessões ativas de usuários em todas as plataformas e revogue permissões. Vincule suas contas OIDC/Locais entre si.
- **Criptografia de Banco de Dados** - Backend armazenado como arquivos de banco de dados SQLite criptografados. Consulte a [documentação](https://docs.termix.site/security) para mais informações.
- **Chaves de API** - Crie chaves de API com escopo de usuário e datas de expiração para uso em automação/CI.
- **Exportação/Importação de Dados** - Exporte e importe hosts SSH, credenciais e dados do gerenciador de arquivos
- **Configuração Automática de SSL** - Geração e gerenciamento integrado de certificados SSL com redirecionamentos HTTPS
- **Interface Moderna** - Interface limpa compatível com desktop/mobile construída com React, Tailwind CSS e Shadcn. Escolha entre muitos temas de interface diferentes, incluindo claro, escuro, Drácula, etc. Use rotas de URL para abrir qualquer conexão em tela cheia.
- **Idiomas** - Suporte integrado para ~30 idiomas (gerenciado pelo [Crowdin](https://docs.termix.site/translations))
- **Suporte a Plataformas** - Disponível como aplicação web, aplicação desktop (Windows, Linux e macOS, pode ser executado de forma independente sem o backend Termix), PWA e aplicativo dedicado para celular/tablet para iOS e Android.
- **Ferramentas SSH** - Crie trechos de comandos reutilizáveis que são executados com um único clique. Execute um comando simultaneamente em múltiplos terminais abertos.
- **Histórico de Comandos** - Autocompletar e visualizar comandos SSH executados anteriormente
- **Conexão Rápida** - Conecte-se a um servidor sem precisar salvar os dados de conexão
- **Paleta de Comandos** - Pressione duas vezes a tecla Shift esquerda para acessar rapidamente as conexões SSH com seu teclado
- **SSH Rico em Funcionalidades** - Suporta jump hosts, Warpgate, conexões baseadas em TOTP, SOCKS5, verificação de chave do host, preenchimento automático de senhas, [OPKSSH](https://github.com/openpubkey/opkssh), tmux, port knocking, etc.
- **Gráfico de Rede** - Personalize seu Dashboard para visualizar seu homelab baseado nas suas conexões SSH com suporte de status
- **Abas Persistentes** - Sessões SSH e abas permanecem abertas entre dispositivos/atualizações se habilitado no perfil do usuário

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
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Visite a [documentação](https://docs.termix.site/install) do Termix para mais informações sobre como instalar o Termix em todas as plataformas. Caso contrário, veja um arquivo Docker Compose de exemplo aqui (você pode omitir o guacd e a rede se não planeja usar recursos de área de trabalho remota):

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

# Suporte

Se você precisa de ajuda ou deseja solicitar uma funcionalidade para o Termix, visite a página de [Issues](https://github.com/Termix-SSH/Support/issues), faça login e clique em `New Issue`.
Por favor, seja o mais detalhado possível no seu relato, preferencialmente escrito em inglês. Você também pode entrar no servidor do [Discord](https://discord.gg/jVQGdvHDrf) e visitar o canal de suporte, porém, os tempos de resposta podem ser mais longos.

# Capturas de Tela

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

Alguns vídeos e imagens podem estar desatualizados ou podem não mostrar perfeitamente as funcionalidades.

# Licença

Distribuído sob a Licença Apache Versão 2.0. Consulte LICENSE para mais informações.
