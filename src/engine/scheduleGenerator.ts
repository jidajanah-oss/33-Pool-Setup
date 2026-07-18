import { NFL_2026_BYE_WEEKS, NFL_2026_TEAMS } from "../data/nfl2026";
import type {
  GeneratedScheduleLine,
  GeneratedScheduleSet,
  NflTeam,
  ScheduleValidationSummary,
} from "../types/pool";

const LINE_COUNT = 32;
const WEEK_COUNT = 18;
const NON_BYE_WEEKS = [1, 2, 3, 4, 12, 15, 16, 17, 18] as const;

interface ByeGroup {
  week: number;
  teams: NflTeam[];
}

type RandomFn = () => number;

function xmur3(value: string) {
  let hash = 1779033703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): RandomFn {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFromSeed(seed: string): RandomFn {
  return mulberry32(xmur3(seed)());
}

function shuffle<T>(values: readonly T[], random: RandomFn): T[] {
  const copy = [...values];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function createSeed(): string {
  const values = new Uint32Array(4);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("-");
}

function startsByWeek(groups: readonly ByeGroup[]): Map<number, number> {
  const starts = new Map<number, number>();
  let cursor = 0;

  for (const group of groups) {
    starts.set(group.week, cursor);
    cursor += group.teams.length;
  }

  return starts;
}

function findDistinctByeLayouts(random: RandomFn): {
  rowOrder: ByeGroup[];
  symbolOrder: ByeGroup[];
  shiftByWeek: Map<number, number>;
} {
  const groups: ByeGroup[] = NFL_2026_BYE_WEEKS.map((group) => ({
    week: group.week,
    teams: [...group.teams],
  }));

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const rowOrder = shuffle(groups, random);
    const symbolOrder = shuffle(groups, random);
    const rowStarts = startsByWeek(rowOrder);
    const symbolStarts = startsByWeek(symbolOrder);
    const shiftByWeek = new Map<number, number>();

    for (const group of groups) {
      const rowStart = rowStarts.get(group.week);
      const symbolStart = symbolStarts.get(group.week);

      if (rowStart === undefined || symbolStart === undefined) {
        throw new Error("Unable to calculate bye-group layout.");
      }

      shiftByWeek.set(
        group.week,
        (symbolStart - rowStart + LINE_COUNT) % LINE_COUNT,
      );
    }

    if (new Set(shiftByWeek.values()).size === groups.length) {
      return { rowOrder, symbolOrder, shiftByWeek };
    }
  }

  throw new Error("Unable to create distinct bye-week rotations.");
}

function buildSchedule(seed: string): GeneratedScheduleLine[] {
  const random = randomFromSeed(seed);
  const { rowOrder, symbolOrder, shiftByWeek } = findDistinctByeLayouts(random);
  const symbolStarts = startsByWeek(symbolOrder);
  const teamAtSymbol = new Array<NflTeam>(LINE_COUNT);

  for (const group of symbolOrder) {
    const start = symbolStarts.get(group.week);

    if (start === undefined) {
      throw new Error(`Missing symbol start for Week ${group.week}.`);
    }

    const shuffledTeams = shuffle(group.teams, random);

    shuffledTeams.forEach((team, offset) => {
      teamAtSymbol[start + offset] = team;
    });
  }

  if (teamAtSymbol.some((team) => !team)) {
    throw new Error("Team symbol table is incomplete.");
  }

  const byeShifts = new Set(shiftByWeek.values());
  const availableShifts = shuffle(
    Array.from({ length: LINE_COUNT }, (_, index) => index).filter(
      (shift) => !byeShifts.has(shift),
    ),
    random,
  );

  NON_BYE_WEEKS.forEach((week, index) => {
    const shift = availableShifts[index];

    if (shift === undefined) {
      throw new Error(`Missing rotation for Week ${week}.`);
    }

    shiftByWeek.set(week, shift);
  });

  if (shiftByWeek.size !== WEEK_COUNT) {
    throw new Error("Not all 18 weekly rotations were created.");
  }

  if (new Set(shiftByWeek.values()).size !== WEEK_COUNT) {
    throw new Error("Weekly rotations are not unique.");
  }

  const lineNumbers = shuffle(
    Array.from({ length: LINE_COUNT }, (_, index) => index + 1),
    random,
  );

  const lines: GeneratedScheduleLine[] = Array.from(
    { length: LINE_COUNT },
    (_, internalRow) => {
      const lineNumber = lineNumbers[internalRow];

      if (lineNumber === undefined) {
        throw new Error("Line-number mapping is incomplete.");
      }

      return {
        lineNumber,
        assignments: Array.from({ length: WEEK_COUNT }, (_, index) => {
          const week = index + 1;
          const shift = shiftByWeek.get(week);

          if (shift === undefined) {
            throw new Error(`Week ${week} does not have a rotation.`);
          }

          const team = teamAtSymbol[(internalRow + shift) % LINE_COUNT];

          if (!team) {
            throw new Error(`Week ${week} has an empty team assignment.`);
          }

          return {
            week,
            teamCode: team.code,
            teamName: team.name,
            isBye: team.byeWeek === week,
          };
        }),
      };
    },
  );

  return lines.sort((a, b) => a.lineNumber - b.lineNumber);
}

export function validateScheduleLines(
  lines: readonly GeneratedScheduleLine[],
): ScheduleValidationSummary {
  const errors: string[] = [];
  const expectedCodes = new Set(NFL_2026_TEAMS.map((team) => team.code));
  let byeAssignmentCount = 0;

  if (lines.length !== LINE_COUNT) {
    errors.push(`Expected 32 lines but found ${lines.length}.`);
  }

  const lineNumbers = lines.map((line) => line.lineNumber);

  if (new Set(lineNumbers).size !== lineNumbers.length) {
    errors.push("A schedule-line number appears more than once.");
  }

  for (const line of lines) {
    if (line.assignments.length !== WEEK_COUNT) {
      errors.push(
        `Line ${line.lineNumber} has ${line.assignments.length} assignments instead of 18.`,
      );
      continue;
    }

    const teamCodes = line.assignments.map((assignment) => assignment.teamCode);

    if (new Set(teamCodes).size !== WEEK_COUNT) {
      errors.push(`Line ${line.lineNumber} contains a repeated NFL team.`);
    }

    const byeAssignments = line.assignments.filter(
      (assignment) => assignment.isBye,
    );
    byeAssignmentCount += byeAssignments.length;

    if (byeAssignments.length !== 1) {
      errors.push(
        `Line ${line.lineNumber} has ${byeAssignments.length} bye assignments instead of one.`,
      );
    }

    for (const assignment of line.assignments) {
      const team = NFL_2026_TEAMS.find(
        (candidate) => candidate.code === assignment.teamCode,
      );

      if (!team) {
        errors.push(
          `Line ${line.lineNumber}, Week ${assignment.week} uses an unknown team.`,
        );
        continue;
      }

      if (assignment.isBye !== (team.byeWeek === assignment.week)) {
        errors.push(
          `Line ${line.lineNumber}, Week ${assignment.week} has an incorrect bye flag.`,
        );
      }
    }
  }

  for (let week = 1; week <= WEEK_COUNT; week += 1) {
    const weeklyAssignments = lines
      .map((line) => line.assignments.find((assignment) => assignment.week === week))
      .filter((assignment) => assignment !== undefined);

    if (weeklyAssignments.length !== LINE_COUNT) {
      errors.push(
        `Week ${week} has ${weeklyAssignments.length} assignments instead of 32.`,
      );
      continue;
    }

    const weeklyCodes = new Set(
      weeklyAssignments.map((assignment) => assignment.teamCode),
    );

    if (weeklyCodes.size !== LINE_COUNT) {
      errors.push(`Week ${week} does not use all 32 NFL teams exactly once.`);
    }

    for (const code of expectedCodes) {
      if (!weeklyCodes.has(code)) {
        errors.push(`Week ${week} is missing ${code}.`);
      }
    }
  }

  const assignmentCount = lines.reduce(
    (total, line) => total + line.assignments.length,
    0,
  );

  if (assignmentCount !== LINE_COUNT * WEEK_COUNT) {
    errors.push(`Expected 576 assignments but found ${assignmentCount}.`);
  }

  if (byeAssignmentCount !== LINE_COUNT) {
    errors.push(
      `Expected 32 total bye assignments but found ${byeAssignmentCount}.`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    lineCount: lines.length,
    weekCount: WEEK_COUNT,
    assignmentCount,
    byeAssignmentCount,
  };
}

export function generateScheduleSet(seed = createSeed()): GeneratedScheduleSet {
  const lines = buildSchedule(seed);
  const validation = validateScheduleLines(lines);

  if (!validation.isValid) {
    throw new Error(validation.errors.join(" "));
  }

  const generatedAt = new Date().toISOString();
  const shortSeed = seed.replaceAll("-", "").slice(0, 10).toUpperCase();

  return {
    version: 1,
    season: 2026,
    id: `33P-2026-${shortSeed}`,
    seed,
    generatedAt,
    lockedAt: null,
    lines,
    validation,
  };
}

export function lockScheduleSet(
  schedule: GeneratedScheduleSet,
): GeneratedScheduleSet {
  const validation = validateScheduleLines(schedule.lines);

  if (!validation.isValid) {
    throw new Error("The schedule cannot be locked because validation failed.");
  }

  return {
    ...schedule,
    lockedAt: schedule.lockedAt ?? new Date().toISOString(),
    validation,
  };
}
