import { evaluate } from '../../../plugin/skills/jev-eval/scripts/jev-run.mjs';
const items = [
  ['Dinner and a bottle of wine', 1], ['Bar tab after the offsite', 1], ['Dinner, two beers and dessert', 1], ['Team drinks at the hotel bar', 1],
  ['Lunch at the Wine Barrel Grill (food only)', 0], ['Dinner with a candidate', 0], ['Coffee and pastries for the workshop', 0], ['Dinner at Brewhouse Kitchen, food only', 0],
  ['Show tickets for the team', 1], ['Museum tickets for a client', 1], ['Taxi to the airport', 0], ['Hotel, 1 night', 0],
];
const Q = {
  is_kind: { type: 'noul', instructions: 'Is the expense described in `description` a kind of expense that is never reimbursable, such as alcohol or entertainment?' },
  includes: { type: 'noul', instructions: 'Does the expense described in `description` include any alcohol or any entertainment (such as shows, tickets or outings), even as part of a larger purchase? Food-only purchases at a venue with a drink-related name do not count.' },
};
const hit = { is_kind: 0, includes: 0 };
for (const [d, truth] of items) {
  const { answers } = await evaluate({ description: d }, Q);
  const line = Object.fromEntries(Object.entries(answers).map(([k, v]) => { const y = v.noul > 0.5 ? 1 : 0; if (y === truth) hit[k]++; return [k, v.noul]; }));
  console.log(truth, d.padEnd(46), JSON.stringify(line));
}
console.log('right of', items.length, hit);
