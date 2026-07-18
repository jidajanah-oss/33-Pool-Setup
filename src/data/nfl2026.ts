import type { NflTeam } from "../types/pool";

export const NFL_2026_BYE_SOURCE = {
  label: "NFL.com — 2026 NFL schedule release: Every team's bye week",
  published: "2026-05-15",
  url: "https://www.nfl.com/news/2026-nfl-schedule-release-every-team-bye-week",
} as const;

export const NFL_2026_TEAMS: NflTeam[] = [
  { code: "ARI", name: "Arizona Cardinals", byeWeek: 14 },
  { code: "ATL", name: "Atlanta Falcons", byeWeek: 11 },
  { code: "BAL", name: "Baltimore Ravens", byeWeek: 13 },
  { code: "BUF", name: "Buffalo Bills", byeWeek: 7 },
  { code: "CAR", name: "Carolina Panthers", byeWeek: 5 },
  { code: "CHI", name: "Chicago Bears", byeWeek: 10 },
  { code: "CIN", name: "Cincinnati Bengals", byeWeek: 6 },
  { code: "CLE", name: "Cleveland Browns", byeWeek: 11 },
  { code: "DAL", name: "Dallas Cowboys", byeWeek: 14 },
  { code: "DEN", name: "Denver Broncos", byeWeek: 10 },
  { code: "DET", name: "Detroit Lions", byeWeek: 6 },
  { code: "GB", name: "Green Bay Packers", byeWeek: 11 },
  { code: "HOU", name: "Houston Texans", byeWeek: 8 },
  { code: "IND", name: "Indianapolis Colts", byeWeek: 13 },
  { code: "JAX", name: "Jacksonville Jaguars", byeWeek: 7 },
  { code: "KC", name: "Kansas City Chiefs", byeWeek: 5 },
  { code: "LV", name: "Las Vegas Raiders", byeWeek: 13 },
  { code: "LAC", name: "Los Angeles Chargers", byeWeek: 7 },
  { code: "LAR", name: "Los Angeles Rams", byeWeek: 11 },
  { code: "MIA", name: "Miami Dolphins", byeWeek: 6 },
  { code: "MIN", name: "Minnesota Vikings", byeWeek: 6 },
  { code: "NE", name: "New England Patriots", byeWeek: 11 },
  { code: "NO", name: "New Orleans Saints", byeWeek: 8 },
  { code: "NYG", name: "New York Giants", byeWeek: 8 },
  { code: "NYJ", name: "New York Jets", byeWeek: 13 },
  { code: "PHI", name: "Philadelphia Eagles", byeWeek: 10 },
  { code: "PIT", name: "Pittsburgh Steelers", byeWeek: 9 },
  { code: "SF", name: "San Francisco 49ers", byeWeek: 8 },
  { code: "SEA", name: "Seattle Seahawks", byeWeek: 11 },
  { code: "TB", name: "Tampa Bay Buccaneers", byeWeek: 10 },
  { code: "TEN", name: "Tennessee Titans", byeWeek: 9 },
  { code: "WAS", name: "Washington Commanders", byeWeek: 7 },
];

export const NFL_2026_BYE_WEEKS = Array.from(
  NFL_2026_TEAMS.reduce((map, team) => {
    const current = map.get(team.byeWeek) ?? [];
    current.push(team);
    map.set(team.byeWeek, current);
    return map;
  }, new Map<number, NflTeam[]>()),
)
  .map(([week, teams]) => ({
    week,
    teams: [...teams].sort((a, b) => a.code.localeCompare(b.code)),
  }))
  .sort((a, b) => a.week - b.week);
