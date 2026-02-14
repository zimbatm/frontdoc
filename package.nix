{ pkgs, ... }:
let
  bun2nix = pkgs.bun2nix;
in
bun2nix.mkDerivation {
  packageJson = ./package.json;
  src = ./.;

  # Bun --compile embeds JS in the binary; strip would corrupt it
  dontStrip = true;

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  # Custom build: compile the webapp then create a standalone binary
  buildPhase = ''
    runHook preBuild

    bun run web:build
    bun build --compile src/main.ts --outfile dist/frontdoc

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -D -m755 dist/frontdoc "$out/bin/frontdoc"

    runHook postInstall
  '';

  meta = {
    description = "CLI tool for managing Markdown document collections";
    homepage = "https://git.numtide.com/numtide/frontdoc-ts";
    mainProgram = "frontdoc";
  };
}
