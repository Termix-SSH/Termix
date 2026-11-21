cask "termix" do
  version "26.11.3"
  sha256 "57450830433a4c4887e51eff5555454e466dc518abf5aea7d81e4e8e8356c740"

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
