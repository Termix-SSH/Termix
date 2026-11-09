cask "termix" do
  version "26.11.1"
  sha256 "923ce662f5c03fe32671e1f3f93623e91818867cc03e327984ef5eca4256e1a0"

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
