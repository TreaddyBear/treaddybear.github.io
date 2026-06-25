import rawMapPack from "../map-exports/lawn-maps.json";
import type { MapPackV1 } from "./mapFormat";

export const mapPack = rawMapPack as unknown as MapPackV1;
