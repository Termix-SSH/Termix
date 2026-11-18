cask "termix" do
  version "26.11.2"
  sha256 "c4ce454521da2a70e289d7864785acb26f318c689b68e673421f0325db97ec38"

  url "https://github.com/Termix-SSH/Termix/releases/download/v#{version}/termix_macos_universal_dmg.dmg"
  name "Termix"
  desc "Self-hosted, plugin-based server management"
  homepage "https://github.com/Termix-SSH/Termix"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "Termix.app"

  zap trash: [
    "~/Library/Application Support/termix",
    "~/Library/Caches/com.karmaa.termix",
    "~/Library/Caches/com.karmaa.termix.ShipIt",
    "~/Library/Preferences/com.karmaa.termix.plist",
    "~/Library/Saved Application State/com.karmaa.termix.savedState",
  ]
end
