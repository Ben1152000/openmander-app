/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for pack files, without a trailing slash.
   * When set, packs are fetched from this server instead of /packs.
   *
   * Example: https://myorg.github.io/openmander-data/packs
   *
   * When unset (default), packs are served from the local /packs directory
   * (the symlink to openmander-data/packs).
   */
  readonly VITE_PACK_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
