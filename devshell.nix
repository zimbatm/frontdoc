{ pkgs }:
pkgs.mkShell {
  packages = [
    pkgs.bun
    pkgs.nodejs
    pkgs.biome
    (pkgs.writeShellScriptBin "frontdoc" ''
      root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
      exec bun "$root/src/main.ts" "$@"
    '')
  ];

  env = { };

  shellHook = ''
  '';
}
