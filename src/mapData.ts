import rawMapPack from "../map-exports/lawn-maps.json";
import type { MapPackV1 } from "./mapFormat";
import { assertMapPackValid } from "./mapValidator";

const pack = rawMapPack as unknown as MapPackV1;
assertMapPackValid(pack);
export const mapPack = pack;
