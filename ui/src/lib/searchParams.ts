type SearchParamUpdates = Record<string, string | null | undefined>

export type PresetPeriod = "this_month" | "last_month" | "all"

export function buildSearchParams(
  searchParams: URLSearchParams,
  updates: SearchParamUpdates
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams)

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      nextSearchParams.delete(key)
      continue
    }
    nextSearchParams.set(key, value)
  }

  return nextSearchParams
}

export function buildPresetPeriodSearchParams(
  searchParams: URLSearchParams,
  period: PresetPeriod,
  updates: SearchParamUpdates = {}
): URLSearchParams {
  return buildSearchParams(searchParams, {
    period,
    start: null,
    end: null,
    ...updates,
  })
}

export function buildCustomPeriodSearchParams(
  searchParams: URLSearchParams,
  start: string,
  end: string,
  updates: SearchParamUpdates = {}
): URLSearchParams {
  return buildSearchParams(searchParams, {
    period: "custom",
    start,
    end,
    ...updates,
  })
}
