/** Prints the determinism probe (M7.0). Compare with packages/client/determinism.html in each browser. */
import { determinismProbe } from '../packages/sim/src/index';

const t = performance.now();
const hashes = determinismProbe();
console.log(hashes.join(' '));
console.log(`final ${hashes.at(-1)}  (${Math.round(performance.now() - t)} ms)`);
