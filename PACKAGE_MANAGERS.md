# Package Manager Submissions for Termix

This document describes the package manager integrations for Termix and how to use them.

## Chocolatey (Windows)

### Overview

Chocolatey package files are located in the `chocolatey/` directory.

### Files

- `termix.nuspec` - Package manifest
- `tools/chocolateyinstall.ps1` - Installation script
- `tools/chocolateyuninstall.ps1` - Uninstallation script

### Automatic Submission

When you run the "Build Electron App" workflow with `artifact_destination: submit`:

1. The workflow builds the Windows x64 MSI
2. Automatically creates a Chocolatey package
3. Pushes to Chocolatey if `CHOCOLATEY_API_KEY` secret is configured

### Setup

Add your Chocolatey API key as a GitHub secret:

- Secret name: `CHOCOLATEY_API_KEY`
- Get your API key from: https://community.chocolatey.org/account

### Manual Submission

If you prefer to submit manually:

1. Download the `chocolatey-package` artifact from GitHub Actions
2. Run: `choco push termix.{VERSION}.nupkg --source https://push.chocolatey.org/`

### Installation (for users)

Once approved on Chocolatey:

```powershell
choco install termix
```

---

## Flatpak (Linux)

### Overview

Flatpak package files are located in the `flatpak/` directory.

### Files

- `com.karmaa.termix.yml` - Flatpak manifest (supports x64 and arm64)
- `com.karmaa.termix.desktop` - Desktop entry file
- `com.karmaa.termix.metainfo.xml` - AppStream metadata
- `flathub.json` - Flathub configuration
- `prepare-flatpak.sh` - Helper script for manual preparation
- `README.md` - Detailed Flatpak documentation

### Automatic Preparation

When you run the "Build Electron App" workflow with `artifact_destination: submit`:

1. The workflow builds Linux x64 and arm64 AppImages
2. Generates all required Flatpak submission files
3. Creates a `flatpak-submission` artifact with everything needed

### Submission Process

Flatpak requires manual PR submission to Flathub:

1. **Download the artifact**
   - Download `flatpak-submission` from the GitHub Actions run
   - Extract all files

2. **Fork Flathub**
   - Go to https://github.com/flathub/flathub
   - Click "Fork"

3. **Prepare your fork**

   ```bash
   git clone https://github.com/YOUR-USERNAME/flathub.git
   cd flathub
   git checkout -b com.karmaa.termix
   ```

4. **Copy submission files**
   - Copy all files from the `flatpak-submission` artifact to your fork root

5. **Submit PR**

   ```bash
   git add .
   git commit -m "Add Termix application"
   git push origin com.karmaa.termix
   ```

   - Go to your fork on GitHub
   - Click "Compare & pull request"
   - Submit to flathub/flathub

6. **Wait for review**
   - Flathub maintainers will review (typically 1-5 days)
   - Be responsive to feedback

### Testing Locally

Before submitting, you can test the Flatpak build:

```bash
# Install flatpak-builder
sudo apt install flatpak-builder

# Build and install
cd flatpak/
flatpak-builder --user --install --force-clean build-dir com.karmaa.termix.yml

# Run
flatpak run com.karmaa.termix
```

### Installation (for users)

Once approved on Flathub:

```bash
flatpak install flathub com.karmaa.termix
```

---

## Homebrew Cask (macOS)

### Overview

Homebrew Cask files are located in the `homebrew/` directory. Casks are used for GUI macOS applications.

### Files

- `termix.rb` - Homebrew Cask formula
- `README.md` - Detailed documentation

### Submission Options

You have two options for distributing via Homebrew:

#### Option 1: Official Homebrew Cask (Recommended)

Submit to https://github.com/Homebrew/homebrew-cask for maximum visibility.

**Advantages:**

- Discoverable by all Homebrew users
- Automatic update checking
- Official Homebrew support

**Process:**

1. Download the `homebrew-submission` artifact from GitHub Actions
2. Fork Homebrew/homebrew-cask
3. Add the cask file to `Casks/t/termix.rb`
4. Test locally and run audit checks
5. Submit PR

**Requirements:**

- App must be stable (not beta)
- Source code must be public
- Must pass `brew audit --cask` checks
- DMG must be code-signed and notarized (already done)

#### Option 2: Custom Tap (Alternative)

Create your own Homebrew tap at `Termix-SSH/homebrew-termix`.

**Advantages:**

- Full control over updates
- No approval process
- Can include beta releases

**Setup:**

```bash
# Create repository: Termix-SSH/homebrew-termix
# Add file: Casks/termix.rb (from homebrew-submission artifact)
```

**Users install with:**

```bash
brew tap termix-ssh/termix
brew install --cask termix
```

### Automatic Preparation

When you run the "Build Electron App" workflow with `artifact_destination: submit`:

1. Builds macOS universal DMG
2. Calculates SHA256 checksum
3. Updates cask file with version and checksum
4. Verifies Ruby syntax
5. Creates a `homebrew-submission` artifact

### Installation (for users)

**From Official Homebrew (after approval):**

```bash
brew install --cask termix
```

**From Custom Tap:**

```bash
brew tap termix-ssh/termix
brew install --cask termix
```

### Updating the Cask

**Official Homebrew Cask:**

- Homebrew bot auto-updates within hours of new releases
- Or manually submit PR with new version/checksum

**Custom Tap:**

- Update version and sha256 in termix.rb
- Commit to your tap repository
- Users run: `brew upgrade --cask termix`

### Testing Locally

```bash
# Test installation
brew install --cask ./homebrew/termix.rb

# Verify it works
open /Applications/Termix.app

# Uninstall
brew uninstall --cask termix

# Run audit
brew audit --cask --online ./homebrew/termix.rb
brew style ./homebrew/termix.rb
```

---

## Workflow Integration

### GitHub Actions Workflow

The `.github/workflows/electron-build.yml` includes three package manager submission jobs:

1. **submit-to-chocolatey** - Automatically submits to Chocolatey
   - Requires: `CHOCOLATEY_API_KEY` secret
   - Runs when: `artifact_destination == 'submit'`
   - Platform: Windows
   - Output: Auto-pushes to Chocolatey + artifact

2. **submit-to-flatpak** - Prepares Flatpak submission files
   - No secrets required
   - Runs when: `artifact_destination == 'submit'`
   - Platform: Linux
   - Output: Artifact for manual Flathub PR (both x64 and arm64)

3. **submit-to-homebrew** - Prepares Homebrew Cask submission files
   - No secrets required
   - Runs when: `artifact_destination == 'submit'`
   - Platform: macOS
   - Output: Artifact for manual Homebrew PR or custom tap

### Usage

When creating a release, select "submit" for artifact destination:

- This will build for all platforms (Windows, Linux, macOS)
- Automatically submit to Chocolatey (if API key is configured)
- Create Flatpak submission artifact for manual Flathub PR
- Create Homebrew submission artifact for manual Homebrew PR or custom tap

### Artifacts Generated

- `chocolatey-package` - .nupkg file (also auto-pushed if key configured)
- `flatpak-submission` - Complete Flathub submission (x64 + arm64)
- `homebrew-submission` - Complete Homebrew Cask submission (universal DMG)

---

## Version Management

Both package managers automatically use the version from `package.json`:

- Current version: 1.8.0
- Version is dynamically injected during the build process
- Download URLs are constructed using the release tag format: `release-{VERSION}-tag`

### Important Notes

- Ensure your GitHub releases follow the tag format: `release-X.Y.Z-tag`
- Example: `release-1.8.0-tag`
- If your tag format differs, update the workflows accordingly

---

## Support

For issues with:

- **Chocolatey package**: Open issue at https://community.chocolatey.org/packages/termix
- **Flatpak package**: Open issue at https://github.com/flathub/com.karmaa.termix
- **Homebrew Cask**:
  - Official: Open issue at https://github.com/Homebrew/homebrew-cask/issues
  - Custom tap: Open issue in your tap repository
- **Build process**: Open issue at https://github.com/Termix-SSH/Termix/issues

## Installation Summary

### Windows

```powershell
# Chocolatey (after approval)
choco install termix
```

### Linux

```bash
# Flatpak (after approval)
flatpak install flathub com.karmaa.termix
```

### macOS

```bash
# Official Homebrew Cask (after approval)
brew install --cask termix

# Or from custom tap
brew tap termix-ssh/termix
brew install --cask termix
```

---

## Future Package Managers

To add support for additional package managers:

1. Create a directory with package files (e.g., `snap/`, `homebrew/`)
2. Add a job to `.github/workflows/electron-build.yml`
3. Update this document with instructions
4. Consider whether submission can be automated or requires manual PR
