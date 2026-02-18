cask "termix" do
  version "1.11.1"
  sha256 "0551e2bd7a3a030ffb967627d04320c1456259dd26b7a992fc02ea0fd9940315"

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
