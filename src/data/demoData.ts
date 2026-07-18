import type {
  NumberSlot,
  PaymentRecord,
  PotWeek,
  ScheduleWeek,
  WeeklyAssignment,
} from "../types/pool";

export const POOL_CONSTANTS = {
  playerCount: 32,
  weeklyFee: 3,
  paidWeeks: 18,
  activeWeeks: 17,
  byeWeeks: 1,
  seasonFee: 54,
  weeklyPot: 96,
  seasonTotal: 1728,
  targetScore: 33,
} as const;

const claimedPlayers: Record<number, string> = {
  2: "Alex",
  5: "Terry",
  8: "Morgan",
  11: "Casey",
  14: "Jordan",
  17: "Demo Player",
  21: "Riley",
  24: "Sam",
  29: "Drew",
  31: "Taylor",
};

export const numberSlots: NumberSlot[] = Array.from({ length: 32 }, (_, index) => {
  const number = index + 1;

  if (number === 17) {
    return { number, status: "mine", playerName: claimedPlayers[number] };
  }

  if (claimedPlayers[number]) {
    return { number, status: "claimed", playerName: claimedPlayers[number] };
  }

  return { number, status: "available" };
});

export const mySchedule: ScheduleWeek[] = [
  { week: 1, team: "Baltimore", teamCode: "BAL", status: "final", score: 27, result: "no-33" },
  { week: 2, team: "Seattle", teamCode: "SEA", status: "live", score: 17 },
  { week: 3, team: "Detroit", teamCode: "DET", status: "upcoming" },
  { week: 4, team: "Las Vegas", teamCode: "LV", status: "upcoming" },
  { week: 5, team: "Buffalo", teamCode: "BUF", status: "upcoming" },
  { week: 6, team: "Dallas", teamCode: "DAL", status: "upcoming" },
  { week: 7, team: "Carolina", teamCode: "CAR", status: "upcoming" },
  { week: 8, team: "Kansas City", teamCode: "KC", status: "upcoming" },
  { week: 9, team: "Green Bay", teamCode: "GB", status: "bye" },
  { week: 10, team: "Miami", teamCode: "MIA", status: "upcoming" },
  { week: 11, team: "Cincinnati", teamCode: "CIN", status: "upcoming" },
  { week: 12, team: "San Francisco", teamCode: "SF", status: "upcoming" },
  { week: 13, team: "Indianapolis", teamCode: "IND", status: "upcoming" },
  { week: 14, team: "Atlanta", teamCode: "ATL", status: "upcoming" },
  { week: 15, team: "New England", teamCode: "NE", status: "upcoming" },
  { week: 16, team: "Arizona", teamCode: "ARI", status: "upcoming" },
  { week: 17, team: "Pittsburgh", teamCode: "PIT", status: "upcoming" },
  { week: 18, team: "Minnesota", teamCode: "MIN", status: "upcoming" },
];

const weekOneTeams = [
  ["Arizona", "ARI"], ["Atlanta", "ATL"], ["Baltimore", "BAL"], ["Buffalo", "BUF"],
  ["Carolina", "CAR"], ["Chicago", "CHI"], ["Cincinnati", "CIN"], ["Cleveland", "CLE"],
  ["Dallas", "DAL"], ["Denver", "DEN"], ["Detroit", "DET"], ["Green Bay", "GB"],
  ["Houston", "HOU"], ["Indianapolis", "IND"], ["Jacksonville", "JAX"], ["Kansas City", "KC"],
  ["Las Vegas", "LV"], ["Los Angeles Chargers", "LAC"], ["Los Angeles Rams", "LAR"], ["Miami", "MIA"],
  ["Minnesota", "MIN"], ["New England", "NE"], ["New Orleans", "NO"], ["New York Giants", "NYG"],
  ["New York Jets", "NYJ"], ["Philadelphia", "PHI"], ["Pittsburgh", "PIT"], ["San Francisco", "SF"],
  ["Seattle", "SEA"], ["Tampa Bay", "TB"], ["Tennessee", "TEN"], ["Washington", "WAS"],
] as const;

export const weeklyAssignments: WeeklyAssignment[] = weekOneTeams.map(([team, teamCode], index) => {
  const number = index + 1;
  const playerName = claimedPlayers[number] ?? `Open Spot ${number}`;

  return {
    number,
    playerName,
    team,
    teamCode,
    status: number <= 10 ? "final" : number <= 18 ? "live" : "not-started",
    score: number <= 10 ? [20, 24, 27, 31, 17, 21, 30, 13, 26, 28][number - 1] : number <= 18 ? number : undefined,
  };
});

export const potWeeks: PotWeek[] = [
  {
    week: 1,
    weeklyAddition: 96,
    carryoverIn: 0,
    availablePot: 96,
    winnerNames: [],
    payout: 0,
    carryoverOut: 96,
    status: "final",
  },
  {
    week: 2,
    weeklyAddition: 96,
    carryoverIn: 96,
    availablePot: 192,
    winnerNames: [],
    payout: 0,
    carryoverOut: 192,
    status: "current",
  },
  {
    week: 3,
    weeklyAddition: 96,
    carryoverIn: 192,
    availablePot: 288,
    winnerNames: [],
    payout: 0,
    carryoverOut: 0,
    status: "upcoming",
  },
];

export const paymentRecord: PaymentRecord = {
  playerName: "Demo Player",
  scheduleNumber: 17,
  amountPaid: 18,
  amountDueThroughCurrentWeek: 6,
  seasonAmountDue: 54,
  winningsEarned: 0,
  winningsPaid: 0,
};

export const rules = [
  "The pool has 32 players and uses all 18 NFL regular-season weeks.",
  "Each player contributes $3 every week, including their bye week, for a $54 season total.",
  "The pool adds $96 each week. Unwon money carries into the next week.",
  "The commissioner generates 32 anonymous schedule lines numbered 1 through 32.",
  "Players choose an available number without seeing the NFL teams attached to that line.",
  "After confirming a number, the player may view the schedule attached to it.",
  "Each line receives a different NFL team every week. A team cannot repeat on the same line.",
  "All 32 NFL teams are assigned exactly once during each week.",
  "Each line has 17 playing-team assignments and one assignment to a team on its NFL bye.",
  "A player wins when the assigned team finishes its game with exactly 33 points.",
  "The assigned team does not have to win its NFL game. Only its final score matters.",
  "If multiple teams finish with 33 in the same week, the qualifying players split the pot equally.",
  "A player may be paid when their account is paid through the week they won.",
  "If no team finishes with 33 in Week 18, the remaining pot goes to the closest final score to 33.",
  "Scores above and below 33 are treated equally. Equally close Week 18 teams split the pot.",
  "NFL opponents have no bearing on the pool and are not displayed.",
];
