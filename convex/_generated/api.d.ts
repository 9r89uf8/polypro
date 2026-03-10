/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as forecastCollector from "../forecastCollector.js";
import type * as http from "../http.js";
import type * as kordPhone from "../kordPhone.js";
import type * as kordPhoneNode from "../kordPhoneNode.js";
import type * as madis from "../madis.js";
import type * as notes from "../notes.js";
import type * as pws from "../pws.js";
import type * as time from "../time.js";
import type * as weather from "../weather.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  forecastCollector: typeof forecastCollector;
  http: typeof http;
  kordPhone: typeof kordPhone;
  kordPhoneNode: typeof kordPhoneNode;
  madis: typeof madis;
  notes: typeof notes;
  pws: typeof pws;
  time: typeof time;
  weather: typeof weather;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
