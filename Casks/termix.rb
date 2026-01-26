cask "termix" do
  version "1.11.0"
  sha256 "c62ea2c3097f466229edcbd65a5ea49d898028a716a3023704c5f644d973c70d"

  url "https://github.com/Termix-SSH/Termix/releases/download/release-#{version}-tag/termix_macos_universal_dmg.dmg"
  name "Termix"
  desc "Web-based server management platform with SSH terminal, tunneling, and file editing"
  homepage "https://github.com/Termix-SSH/Termix"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Termix.app"

  zap trash: [
    "~/Library/Application Support/termix",
    "~/Library/Caches/com.karmaa.termix",
    "~/Library/Caches/com.karmaa.termix.ShipIt",
    "~/Library/Preferences/com.karmaa.termix.plist",
    "~/Library/Saved Application State/com.karmaa.termix.savedState",
  ]
end
