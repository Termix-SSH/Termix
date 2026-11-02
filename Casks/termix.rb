cask "termix" do
  version "26.11.0"
  sha256 "1b873e1315d769f8e416c1690032142efb152d1265c2f078b33f72cec3e6e03e"

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
