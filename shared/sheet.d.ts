// `?sheet` imports (dev/sheet-plugin.ts): an image sheet decoded at build time.
declare module '*.png?sheet' {
  const sheet: import('../engine/core/images.ts').RawSheet;
  export default sheet;
}
