{ pkgs }:
pkgs.mkShell {
  packages = [
    pkgs.bun
    pkgs.biome
    (pkgs.writeShellScriptBin "tmdoc" ''
      root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
      exec bun "$root/src/main.ts" "$@"
    '')
  ];

  env = { };

  shellHook = ''
  '';
}
