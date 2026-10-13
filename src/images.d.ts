// Static image imports (the landing demo's profile pictures). next-env.d.ts declares these too, but it is generated
// by `next dev` or `next build` and git-ignored, so a clean checkout (CI typecheck) needs its own declaration.
declare module "*.jpg" {
  const image: import("next/image").StaticImageData;
  export default image;
}
