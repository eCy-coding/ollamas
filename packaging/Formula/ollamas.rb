# DRAFT Homebrew formula for the ollamas CLI (prebuilt single binary).
# Not a live tap. To ship: build per-arch binaries (cli/build-binary.sh), attach
# them to a GitHub release, fill in `version` + real urls + sha256, and host this
# file in a personal tap repo `homebrew-ollamas` under Formula/ollamas.rb.
# Then: `brew tap <you>/ollamas && brew install ollamas`.
class Ollamas < Formula
  desc "Zero-dependency CLI for the ollamas LLM Mission Control gateway"
  homepage "https://github.com/<you>/ollamas"
  version "9.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/<you>/ollamas/releases/download/v#{version}/ollamas-darwin-arm64"
      sha256 "REPLACE_WITH_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/<you>/ollamas/releases/download/v#{version}/ollamas-darwin-x64"
      sha256 "REPLACE_WITH_X64_SHA256"
    end
  end

  def install
    bin.install Dir["ollamas-*"].first => "ollamas"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ollamas version")
  end
end
