cask "termix" do
  version "1.9.0"
  sha256 "8fedd242b3cae1ebfd0c391a36f1c246a26ecac258b02478ee8dea2f33cd6d96"

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
