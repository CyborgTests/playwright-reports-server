/**
 * Splits an arbitrary [from, to) ISO-timestamp range into whole UTC days
 * (read from the daily_test_totals summary table) plus up to two partial days at
 * the range start/end
 */
export interface WindowPart {
  /** Whole UTC days ('YYYY-MM-DD') fully inside the range from the summary table. */
  interiorDays: string[];
  /** Partial days at the range start/end — queried from test_runs. */
  edgeRanges: Array<{ fromIso: string; toIsoExclusive: string }>;
  /** Set only when there's no `from`, include every summary day strictly before this day */
  allBeforeDay?: string;
}

function nextUtcMidnight(dayStartIso: string): string {
  const date = new Date(dayStartIso);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  ).toISOString();
}

function floorToUtcDay(iso: string): string {
  const date = new Date(iso);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  ).toISOString();
}

export function resolveWindow(fromIso?: string, toIso?: string): WindowPart {
  const interiorDays: string[] = [];
  const edgeRanges: WindowPart['edgeRanges'] = [];

  const effectiveTo = toIso ?? new Date().toISOString();
  const result: WindowPart = { interiorDays, edgeRanges };

  if (fromIso && fromIso >= effectiveTo) return result;

  let cursor: string;
  if (!fromIso) {
    cursor = floorToUtcDay(effectiveTo);
    result.allBeforeDay = cursor.slice(0, 10);
  } else {
    cursor = floorToUtcDay(fromIso);
    if (cursor !== fromIso) {
      const firstMidnight = nextUtcMidnight(fromIso);
      if (firstMidnight >= effectiveTo) {
        edgeRanges.push({ fromIso, toIsoExclusive: effectiveTo });
        return result;
      }
      edgeRanges.push({ fromIso, toIsoExclusive: firstMidnight });
      cursor = firstMidnight;
    }
  }

  while (cursor < effectiveTo) {
    const dayEnd = nextUtcMidnight(cursor);
    if (effectiveTo <= dayEnd) {
      if (effectiveTo === dayEnd) {
        interiorDays.push(cursor.slice(0, 10));
      } else if (effectiveTo > cursor) {
        edgeRanges.push({ fromIso: cursor, toIsoExclusive: effectiveTo });
      }
      break;
    }
    interiorDays.push(cursor.slice(0, 10));
    cursor = dayEnd;
  }

  return result;
}
