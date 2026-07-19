cask "termix" do
  version "2.5.1"
  sha256 "39f88b6fb6f8841496fe689968decbbc4f4baa92ab5a3a41a738123cf7daeb3f"

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
