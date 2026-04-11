/* tslint:disable */
/* eslint-disable */

export class WasmMap {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Return geo_ids in index order for every layer, as a JSON string.
     * Shape: `{"block": ["geo1", "geo2", ...], "county": [...], ...}`
     * Used by the plan worker to populate geoIdByIndex immediately on ready,
     * without waiting for the metrics worker to parse the full CSV.
     */
    geo_id_index_json(): string;
    /**
     * Return present layers as an array of strings.
     */
    layers_present(): any;
    /**
     * Construct a Map from an in-memory pack:
     * files: { "data/block.parquet": Uint8Array, "adj/block.csr.bin": Uint8Array, ... }
     */
    constructor(files: any);
    /**
     * Export layer geometries as GeoJSON FeatureCollection.
     * Returns GeoJSON as a JavaScript object.
     * bounds: Optional bounding box [min_lon, min_lat, max_lon, max_lat] to filter features.
     */
    to_geojson(layer?: string | null, bounds?: Float64Array | null): any;
    /**
     * Generate SVG text for a given layer, optionally colored by series.
     * Returns SVG XML string (UI can set innerHTML or create Blob).
     */
    to_svg(layer?: string | null, series?: string | null): string;
}

export class WasmPlan {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Totals for all parts including unassigned (index 0). Returns a JS array of numbers.
     */
    all_part_totals(series: string): any;
    anneal_balance(series: string, max_iter: number, initial_temp: number, final_temp: number, boundary_factor: number): void;
    /**
     * Assign all blocks belonging to a geographic unit to a given district.
     * `layer`: geographic level ("block", "vtd", "tract", "county", etc.)
     * `geo_id`: FIPS identifier for the unit at that level.
     * `district`: target district (1-indexed; 0 = unassigned). Contiguity is not enforced.
     */
    assign_unit(layer: string, geo_id: string, district: number): void;
    /**
     * Assign all blocks belonging to multiple geographic units to a district in one pass.
     * `geo_ids`: JS array of FIPS strings. Processes all units before returning, so only
     * one geometry/stats recomputation is needed instead of one per unit.
     */
    assign_units_batch(layer: string, geo_ids: Array<any>, district: number): void;
    /**
     * Compatibility assignments export: returns { "geoid": district } (slow for blocks).
     */
    assignments_dict(): any;
    /**
     * FAST assignments export: return a Uint32Array of length = #units in active layer.
     */
    assignments_u32(): Uint32Array;
    /**
     * Get district geometries as WKB bytes.
     *
     * Returns a JavaScript array of objects: [{ district: number, wkb: Uint8Array }, ...]
     * Districts 1 through num_districts are included. District 0 (unassigned) is excluded.
     */
    district_geometries_wkb(): Array<any>;
    /**
     * District totals for a series. Returns a JS array of numbers.
     */
    district_totals(series: string): any;
    equalize(series: string, tolerance: number, max_iter: number): void;
    /**
     * Run one outer iteration of equalization. Returns `true` if converged.
     */
    equalize_step(series: string, tolerance: number): boolean;
    /**
     * Load assignments from CSV *text* (browser has no file paths).
     */
    load_csv_text(csv: string): void;
    constructor(map: WasmMap, num_districts: number);
    num_districts(): number;
    randomize(): void;
    recombine(a: number, b: number): void;
    /**
     * Series available in the map's weights.
     */
    series(): any;
    /**
     * Set assignments from a Uint32Array (index-based).
     */
    set_assignments_u32(arr: Uint32Array): void;
    tabu_balance(series: string, max_iter: number, tabu_tenure: number, boundary_factor: number, candidates_per_iter: number): void;
    /**
     * Export CSV as *text*.
     */
    to_csv_text(): string;
    /**
     * Export layer geometries as GeoJSON FeatureCollection with district assignments.
     * Returns GeoJSON as a JavaScript object.
     * Note: assignments are for the base layer (blocks), so this only works for the base layer.
     * bounds: Optional bounding box [min_lon, min_lat, max_lon, max_lat] to filter features.
     */
    to_geojson(layer?: string | null, bounds?: Float64Array | null): any;
}

/**
 * Called automatically when the WASM module is instantiated.
 * Sets up panic hook so Rust panics appear as console.error in the browser.
 */
export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmplan_free: (a: number, b: number) => void;
    readonly wasmplan_all_part_totals: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmplan_anneal_balance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmplan_assign_unit: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasmplan_assign_units_batch: (a: number, b: number, c: number, d: any, e: number) => [number, number];
    readonly wasmplan_assignments_dict: (a: number) => [number, number, number];
    readonly wasmplan_assignments_u32: (a: number) => [number, number, number];
    readonly wasmplan_district_geometries_wkb: (a: number) => [number, number, number];
    readonly wasmplan_district_totals: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmplan_equalize: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmplan_equalize_step: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmplan_load_csv_text: (a: number, b: number, c: number) => [number, number];
    readonly wasmplan_new: (a: number, b: number) => [number, number, number];
    readonly wasmplan_num_districts: (a: number) => number;
    readonly wasmplan_randomize: (a: number) => [number, number];
    readonly wasmplan_recombine: (a: number, b: number, c: number) => [number, number];
    readonly wasmplan_series: (a: number) => [number, number, number];
    readonly wasmplan_set_assignments_u32: (a: number, b: any) => [number, number];
    readonly wasmplan_tabu_balance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly wasmplan_to_csv_text: (a: number) => [number, number, number, number];
    readonly wasmplan_to_geojson: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly __wbg_wasmmap_free: (a: number, b: number) => void;
    readonly wasmmap_geo_id_index_json: (a: number) => [number, number, number, number];
    readonly wasmmap_layers_present: (a: number) => [number, number, number];
    readonly wasmmap_new: (a: any) => [number, number, number];
    readonly wasmmap_to_geojson: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmmap_to_svg: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly init: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
