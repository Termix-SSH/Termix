# Homebrew Cask for Termix

This directory contains the Homebrew Cask formula for installing Termix on macOS.

## Files

- **termix.rb** - Homebrew Cask formula

## What is a Homebrew Cask?

Homebrew Casks are used to install GUI macOS applications. Unlike formulae (which are for command-line tools), casks handle:

- Downloading DMG/PKG installers
- Installing .app bundles to /Applications
- Managing application preferences and cache cleanup

## Submission Options

You have two options for distributing Termix via Homebrew:

### Option 1: Submit to Official Homebrew Cask (Recommended)

Submit to the official homebrew-cask repository for maximum visibility.

**Advantages:**

- Discoverable by all Homebrew users
- Built-in update checking
- Official Homebrew support

**Process:**

1. Download the `homebrew-submission` artifact from GitHub Actions (when using "submit" option)
2. Fork https://github.com/Homebrew/homebrew-cask
3. Create a new branch: `git checkout -b termix`
4. Add the cask file: `Casks/t/termix.rb` (note the subdirectory by first letter)
5. Test locally: `brew install --cask ./Casks/t/termix.rb`
6. Run audit: `brew audit --cask --online ./Casks/t/termix.rb`
7. Commit and push to your fork
8. Create a PR to Homebrew/homebrew-cask

**Requirements for acceptance:**

- App must be stable (not beta/alpha)
- Source code must be public
- No analytics/tracking without opt-in
- Pass all brew audit checks

### Option 2: Create Your Own Tap

Create a custom Homebrew tap for more control and faster updates.

**Advantages:**

- Full control over updates
- No approval process
- Can include beta/alpha releases

**Process:**

1. Create a new repository: `Termix-SSH/homebrew-termix`
2. Add the cask file to: `Casks/termix.rb`
3. Users install with: `brew install --cask termix-ssh/termix/termix`

## Installation (for users)

### From Official Homebrew Cask (after approval):

```bash
brew install --cask termix
```

### From Custom Tap:

```bash
# Add the tap
brew tap termix-ssh/termix

# Install the cask
brew install --cask termix
```

## Updating the Cask

When you release a new version:

### For Official Homebrew Cask:

1. Homebrew bot usually auto-updates within hours
2. Or manually submit a PR with the new version/checksum

### For Custom Tap:

1. Update the version and sha256 in termix.rb
2. Commit and push to your tap repository
3. Users run: `brew upgrade --cask termix`

## Testing Locally

Before submitting, test the cask:

```bash
# Install from local file
brew install --cask ./homebrew/termix.rb

# Verify it works
open /Applications/Termix.app

# Uninstall
brew uninstall --cask termix

# Run audit checks
brew audit --cask --online ./homebrew/termix.rb

# Style check
brew style ./homebrew/termix.rb
```

## Automated Submission Preparation

The GitHub Actions workflow automatically prepares the Homebrew submission when you select "submit":

1. Builds macOS universal DMG
2. Calculates SHA256 checksum
3. Updates the cask file with version and checksum
4. Creates a `homebrew-submission` artifact

Download the artifact and follow the submission instructions included.

## Cask File Structure

The cask file (`termix.rb`) includes:

- **version** - Automatically set from package.json
- **sha256** - Checksum of the universal DMG for security
- **url** - Download URL from GitHub releases
- **name** - Display name
- **desc** - Short description
- **homepage** - Project homepage
- **livecheck** - Automatic update detection
- **app** - The .app bundle to install
- **zap** - Files to remove on complete uninstall

## Requirements

- macOS 10.15 (Catalina) or later
- Homebrew 4.0.0 or later
- Universal DMG must be code-signed and notarized (already handled by your build process)

## Resources

- [Homebrew Cask Documentation](https://docs.brew.sh/Cask-Cookbook)
- [Cask Submission Guidelines](https://github.com/Homebrew/homebrew-cask/blob/master/CONTRIBUTING.md)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
