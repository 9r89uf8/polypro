/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aeroweb from "../aeroweb.js";
import type * as aerowebShared from "../aerowebShared.js";
import type * as ankara from "../ankara.js";
import type * as crons from "../crons.js";
import type * as forecastCollector from "../forecastCollector.js";
import type * as http from "../http.js";
import type * as kordPhone from "../kordPhone.js";
import type * as kordPhoneNode from "../kordPhoneNode.js";
import type * as madis from "../madis.js";
import type * as madrid from "../madrid.js";
import type * as madridDatis from "../madridDatis.js";
import type * as madridDatisAccess from "../madridDatisAccess.js";
import type * as madridDatisParser from "../madridDatisParser.js";
import type * as madridDatisStream from "../madridDatisStream.js";
import type * as madridDatisStreamAccess from "../madridDatisStreamAccess.js";
import type * as madridDatisStreamLifecycle from "../madridDatisStreamLifecycle.js";
import type * as madridDatisStreamNode from "../madridDatisStreamNode.js";
import type * as madridDatisStreamParser from "../madridDatisStreamParser.js";
import type * as mexico from "../mexico.js";
import type * as mexicoCapma from "../mexicoCapma.js";
import type * as mexicoCapmaNode from "../mexicoCapmaNode.js";
import type * as mexicoCapmaOcr from "../mexicoCapmaOcr.js";
import type * as mexicoCapmaSimilarity from "../mexicoCapmaSimilarity.js";
import type * as mexicoForecastNode from "../mexicoForecastNode.js";
import type * as mexicoPolymarket from "../mexicoPolymarket.js";
import type * as milan from "../milan.js";
import type * as notes from "../notes.js";
import type * as nzwnWeather from "../nzwnWeather.js";
import type * as parisWeather from "../parisWeather.js";
import type * as preflight from "../preflight.js";
import type * as pws from "../pws.js";
import type * as seoul from "../seoul.js";
import type * as seoulGk2a from "../seoulGk2a.js";
import type * as seoulGk2aCollector from "../seoulGk2aCollector.js";
import type * as seoulGk2aNode from "../seoulGk2aNode.js";
import type * as seoulHighPredictionModel from "../seoulHighPredictionModel.js";
import type * as seoulKmaForecast from "../seoulKmaForecast.js";
import type * as seoulKmaForecastNode from "../seoulKmaForecastNode.js";
import type * as seoulKmaForecastParser from "../seoulKmaForecastParser.js";
import type * as seoulKmaTls from "../seoulKmaTls.js";
import type * as seoulWeather from "../seoulWeather.js";
import type * as synoptic from "../synoptic.js";
import type * as time from "../time.js";
import type * as weather from "../weather.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aeroweb: typeof aeroweb;
  aerowebShared: typeof aerowebShared;
  ankara: typeof ankara;
  crons: typeof crons;
  forecastCollector: typeof forecastCollector;
  http: typeof http;
  kordPhone: typeof kordPhone;
  kordPhoneNode: typeof kordPhoneNode;
  madis: typeof madis;
  madrid: typeof madrid;
  madridDatis: typeof madridDatis;
  madridDatisAccess: typeof madridDatisAccess;
  madridDatisParser: typeof madridDatisParser;
  madridDatisStream: typeof madridDatisStream;
  madridDatisStreamAccess: typeof madridDatisStreamAccess;
  madridDatisStreamLifecycle: typeof madridDatisStreamLifecycle;
  madridDatisStreamNode: typeof madridDatisStreamNode;
  madridDatisStreamParser: typeof madridDatisStreamParser;
  mexico: typeof mexico;
  mexicoCapma: typeof mexicoCapma;
  mexicoCapmaNode: typeof mexicoCapmaNode;
  mexicoCapmaOcr: typeof mexicoCapmaOcr;
  mexicoCapmaSimilarity: typeof mexicoCapmaSimilarity;
  mexicoForecastNode: typeof mexicoForecastNode;
  mexicoPolymarket: typeof mexicoPolymarket;
  milan: typeof milan;
  notes: typeof notes;
  nzwnWeather: typeof nzwnWeather;
  parisWeather: typeof parisWeather;
  preflight: typeof preflight;
  pws: typeof pws;
  seoul: typeof seoul;
  seoulGk2a: typeof seoulGk2a;
  seoulGk2aCollector: typeof seoulGk2aCollector;
  seoulGk2aNode: typeof seoulGk2aNode;
  seoulHighPredictionModel: typeof seoulHighPredictionModel;
  seoulKmaForecast: typeof seoulKmaForecast;
  seoulKmaForecastNode: typeof seoulKmaForecastNode;
  seoulKmaForecastParser: typeof seoulKmaForecastParser;
  seoulKmaTls: typeof seoulKmaTls;
  seoulWeather: typeof seoulWeather;
  synoptic: typeof synoptic;
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
