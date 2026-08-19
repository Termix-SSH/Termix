cask "termix" do
  version "2.7.0"
  sha256 "8cdae5cf5ce2786e35a1a676dec51974cfca318a5595bc743981a4c373515059"

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
