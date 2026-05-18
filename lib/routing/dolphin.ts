const FRAMES: string[] = [
  `       __
   ___( o)>
   \\_____/
   ~~~~~~~~~`,
  `       __
   ___( o)>
   \\,___,/
   ~~~~~~~~~`,
  `       __
   ___( o)>
   \\\`___\`/
   ~~~~~~~~~`,
];

export function getDolphinFrame(callIndex: number): string {
  return FRAMES[((callIndex % 3) + 3) % 3];
}
