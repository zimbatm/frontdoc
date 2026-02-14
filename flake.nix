{
  description = "frontdoc - CLI tool for managing Markdown document collections";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs?ref=nixos-unstable";
    blueprint.url = "github:numtide/blueprint";
    blueprint.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs: inputs.blueprint {
    inherit inputs;
    nixpkgs.overlays = [ inputs.bun2nix.overlays.default ];
  };
}
