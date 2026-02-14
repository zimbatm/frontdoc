{ pkgs ? import <nixpkgs> { } }:

pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tmdoc";
  version = "0.1.0";

  # Keep source as-is so local `node_modules` can be used when present.
  src = ./.;

  nativeBuildInputs = [
    pkgs.bun
    pkgs.makeWrapper
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR"
    if [ ! -d node_modules ]; then
      bun install --frozen-lockfile
    fi

    bun run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -D -m755 dist/tmdoc "$out/bin/tmdoc"

    runHook postInstall
  '';

  meta = {
    description = "CLI tool for managing Markdown document collections";
    homepage = "https://git.numtide.com/numtide/tmdoc-ts";
    license = pkgs.lib.licenses.mit;
    mainProgram = "tmdoc";
    platforms = pkgs.lib.platforms.unix;
  };
})
