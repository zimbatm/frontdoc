{ pkgs }:
pkgs.mkShell {
  packages = [
    pkgs.bun
    pkgs.biome
  ];

  env = { };

  shellHook = ''
  '';
}
