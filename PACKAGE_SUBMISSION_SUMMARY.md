# Package Submission Setup Summary

This document summarizes all the package manager integrations that have been set up for Termix.

## Overview

Termix now has complete package manager support for all three major platforms:

- **Windows**: Chocolatey
- **Linux**: Flatpak (Flathub)
- **macOS**: Homebrew Cask

## Files Created

### Chocolatey (Windows)

```
chocolatey/
├── termix.nuspec                      # Package manifest
└── tools/
    ├── chocolateyinstall.ps1          # Installation script
    └── chocolateyuninstall.ps1        # Uninstallation script
```

### Flatpak (Linux)

```
flatpak/
├── com.karmaa.termix.yml              # Flatpak manifest (x64 & arm64)
├── com.karmaa.termix.desktop          # Desktop entry file
├── com.karmaa.termix.metainfo.xml     # AppStream metadata
├── flathub.json                       # Flathub configuration
├── prepare-flatpak.sh                 # Helper script
└── README.md                          # Detailed documentation
```

### Homebrew (macOS)

```
homebrew/
├── termix.rb                          # Homebrew Cask formula
└── README.md                          # Detailed documentation
```

### Documentation

```
PACKAGE_MANAGERS.md                    # Complete guide for all package managers
PACKAGE_SUBMISSION_SUMMARY.md          # This file
```

### Modified Files

```
.github/workflows/electron-build.yml   # Added 3 new submission jobs
```

## GitHub Actions Integration

### New Jobs Added to Workflow

1. **submit-to-chocolatey** (Lines 551-654)
   - Platform: Windows
   - Trigger: `artifact_destination == 'submit'`
   - Actions:
     - Downloads Windows x64 MSI
     - Calculates SHA256 checksum
     - Updates package manifest with version/checksum
     - Packs Chocolatey package
     - Automatically pushes to Chocolatey (if API key configured)
     - Creates artifact for backup

2. **submit-to-flatpak** (Lines 656-844)
   - Platform: Linux (Ubuntu)
   - Trigger: `artifact_destination == 'submit'`
   - Actions:
     - Downloads x64 and arm64 AppImages
     - Calculates SHA256 checksums for both architectures
     - Generates PNG icons from SVG
     - Updates manifest and metainfo with version/checksums/date
     - Creates complete submission artifact
     - Includes detailed submission instructions

3. **submit-to-homebrew** (Lines 846-1059)
   - Platform: macOS
   - Trigger: `artifact_destination == 'submit'`
   - Actions:
     - Downloads macOS universal DMG
     - Calculates SHA256 checksum
     - Updates Cask formula with version/checksum
     - Verifies Ruby syntax
     - Creates submission artifact
     - Includes instructions for both official and custom tap

## Setup Required

### Chocolatey (Automated)

Add GitHub secret to enable automatic submission:

- **Secret name**: `CHOCOLATEY_API_KEY`
- **Get from**: https://community.chocolatey.org/account
- **Location**: Repository Settings → Secrets and variables → Actions

### Flatpak (Manual)

No secrets required. Process:

1. Run workflow with "submit" option
2. Download `flatpak-submission` artifact
3. Fork https://github.com/flathub/flathub
4. Copy files and create PR

### Homebrew (Manual)

No secrets required. Two options:

**Option 1: Official Homebrew**

1. Run workflow with "submit" option
2. Download `homebrew-submission` artifact
3. Fork https://github.com/Homebrew/homebrew-cask
4. Add to `Casks/t/termix.rb` and create PR

**Option 2: Custom Tap**

1. Create repository: `Termix-SSH/homebrew-termix`
2. Add `Casks/termix.rb` from artifact
3. Users install with: `brew tap termix-ssh/termix && brew install --cask termix`

## How to Use

### For Each Release:

1. **Prepare Release**
   - Ensure version in `package.json` is updated
   - Create GitHub release with tag format: `release-X.Y.Z-tag`
   - Example: `release-1.8.0-tag`

2. **Run Build Workflow**
   - Go to Actions → "Build Electron App"
   - Click "Run workflow"
   - Select options:
     - **Platform**: `all` (or specific platform)
     - **Artifact destination**: `submit`

3. **Automated Submissions**
   - **Chocolatey**: Automatically pushed (if API key configured)
     - Package appears on Chocolatey within hours
     - Users can install with: `choco install termix`

4. **Manual Submissions**
   - **Flatpak**: Download `flatpak-submission` artifact
     - Follow instructions in `SUBMISSION_INSTRUCTIONS.md`
     - Submit PR to flathub/flathub
     - Review time: 1-5 days

   - **Homebrew**: Download `homebrew-submission` artifact
     - Follow instructions in `SUBMISSION_INSTRUCTIONS.md`
     - Option 1: Submit PR to Homebrew/homebrew-cask
     - Option 2: Push to custom tap
     - Review time (official): 24-48 hours

## Version Management

All package managers automatically use the version from `package.json`:

- Current version: **1.8.0**
- Version format: Semantic versioning (X.Y.Z)
- All checksums calculated automatically
- Download URLs constructed automatically

## Important Notes

### Release Tag Format

The workflows expect GitHub release tags in this format:

```
release-{VERSION}-tag
```

Examples:

- ✅ `release-1.8.0-tag`
- ✅ `release-2.0.0-tag`
- ❌ `v1.8.0`
- ❌ `1.8.0`

If your tag format is different, update these lines in the workflows:

- **Chocolatey**: Line 597
- **Flatpak**: Lines 724-725
- **Homebrew**: Line 900

### Code Signing Requirements

All builds require proper code signing:

- **Windows MSI**: Already signed via electron-builder
- **Linux AppImage**: No signing required
- **macOS DMG**: Must be signed and notarized (already configured)

### File Naming Conventions

The workflows expect these file naming patterns:

- Windows: `termix_windows_x64_{version}_msi.msi`
- Linux x64: `termix_linux_x64_{version}_appimage.AppImage`
- Linux arm64: `termix_linux_arm64_{version}_appimage.AppImage`
- macOS: `termix_macos_universal_{version}_dmg.dmg`

These are already configured in `electron-builder.json`.

## Testing Locally

### Chocolatey

```powershell
cd chocolatey
choco pack termix.nuspec
choco install termix -s . -y
```

### Flatpak

```bash
cd flatpak
flatpak-builder --user --install --force-clean build-dir com.karmaa.termix.yml
flatpak run com.karmaa.termix
```

### Homebrew

```bash
cd homebrew
brew install --cask ./termix.rb
brew uninstall --cask termix
```

## User Installation Commands

Once approved on all platforms:

```bash
# Windows (Chocolatey)
choco install termix

# Linux (Flatpak)
flatpak install flathub com.karmaa.termix

# macOS (Homebrew - Official)
brew install --cask termix

# macOS (Homebrew - Custom Tap)
brew tap termix-ssh/termix
brew install --cask termix
```

## Update Strategy

### Chocolatey

- Updates pushed automatically when you run workflow with "submit"
- Users update with: `choco upgrade termix`

### Flatpak

- After initial approval, you get a repository: `flathub/com.karmaa.termix`
- For updates: commit new version/checksum to that repo
- Flathub auto-builds and publishes
- Users update with: `flatpak update`

### Homebrew (Official)

- Homebrew bot auto-updates within hours of new releases
- Detects new releases via GitHub releases
- Users update with: `brew upgrade --cask termix`

### Homebrew (Custom Tap)

- Manually update the cask file in your tap repo
- Users update with: `brew upgrade --cask termix`

## Resources

- [Chocolatey Documentation](https://docs.chocolatey.org/)
- [Flatpak Documentation](https://docs.flatpak.org/)
- [Flathub Submission](https://docs.flathub.org/docs/for-app-authors/submission)
- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [AppStream Guidelines](https://www.freedesktop.org/software/appstream/docs/)

## Support

For issues:

- **Build/Workflow**: https://github.com/Termix-SSH/Termix/issues
- **Chocolatey**: https://community.chocolatey.org/packages/termix
- **Flatpak**: https://github.com/flathub/com.karmaa.termix/issues
- **Homebrew**: https://github.com/Homebrew/homebrew-cask/issues (or your custom tap)

---

**Next Steps:**

1. Add `CHOCOLATEY_API_KEY` to GitHub secrets
2. Run workflow with "submit" option for your next release
3. Download artifacts and follow submission instructions
4. Monitor submission PRs and respond to feedback
