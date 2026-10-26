// Time limits for performance tests. Shared CI machines (especially Windows
// runners) are several times slower than a laptop; the limits still catch
// what they exist for, since a quadratic blow-up is 100x slower, not 4x.

const CI_SLOWDOWN = 4;

export const budget = (ms) => ms * (process.env.CI ? CI_SLOWDOWN : 1);
