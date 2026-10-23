import { BloomFilter } from './core.js';

/**
 * Public surface of the library.
 *
 * We export exactly one name so consumers can tree-shake and the API surface
 * stays small.  There is no default export: named imports make it obvious
 * which symbol is being used and prevent the footgun of importing an
 * unrelated default.
 */
export { BloomFilter };
