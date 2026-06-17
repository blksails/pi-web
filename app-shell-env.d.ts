/**
 * Local ambient override for the app's type program only.
 *
 * Next augments `NodeJS.ProcessEnv` to make `NODE_ENV` a required readonly
 * field (see `next/types/global.d.ts`). That augmentation is global, so when
 * the app's `tsc` traverses the imported `@pi-web/*` source (raw `.ts`), it
 * flags object literals there that don't set `NODE_ENV` — even though those
 * packages type-check green under their own (non-Next) configs.
 *
 * Relaxing `NODE_ENV` back to optional here keeps the app program honest about
 * app code while not re-flagging untouched, already-green upstream sources.
 * This file is scoped to the app tsconfig and never compiled into the packages.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | "test";
  }
}
