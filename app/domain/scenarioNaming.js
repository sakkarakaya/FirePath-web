const SCENARIO_NAME_PREFIX = "Scenario";

/**
 * Builds the next free "Scenario N" label.
 *
 * Scans for the lowest unused number rather than using the list length, so
 * saving after deleting an earlier scenario cannot produce a duplicate name.
 */
export function buildScenarioName(existing) {
  const taken = new Set(existing.map((scenario) => scenario.name.trim()));

  let index = 1;
  while (taken.has(`${SCENARIO_NAME_PREFIX} ${index}`)) {
    index += 1;
  }

  return `${SCENARIO_NAME_PREFIX} ${index}`;
}
