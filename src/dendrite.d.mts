export interface DendriteSeg {
  a: [number, number, number];
  b: [number, number, number];
  t: number;
  cls: "w" | "d" | "amber";
}
export function genDendrite(seed?: number): DendriteSeg[];
