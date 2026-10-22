cask "termix" do
  version "26.10.5"
  sha256 "808c467c5c34402193c7950ce61df0fa0445782f276348cf31ef235a6427d21c"

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
