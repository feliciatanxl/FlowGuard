// Unit tests for the shared backend source of truth (config/detectionTypes.js) behind
// both routes/zones.js validation and utils/detectionAlertBridge.js's alert mapping.
const {
  DETECTION_TYPES,
  DEFAULT_DETECTION_TYPE,
  INCIDENT_TYPE_BY_DETECTION_TYPE,
} = require("../../config/detectionTypes");

describe("config/detectionTypes", () => {
  test("exposes the three existing Detection Setup categories", () => {
    expect(DETECTION_TYPES.sort()).toEqual(
      ["crowd_density", "unattended_object", "unauthorized_access"].sort()
    );
  });

  test("DEFAULT_DETECTION_TYPE is one of DETECTION_TYPES", () => {
    expect(DETECTION_TYPES).toContain(DEFAULT_DETECTION_TYPE);
  });

  test("every detection_type maps to an incident type", () => {
    DETECTION_TYPES.forEach((type) => {
      expect(typeof INCIDENT_TYPE_BY_DETECTION_TYPE[type]).toBe("string");
    });
  });

  test("INCIDENT_TYPE_BY_DETECTION_TYPE is the single source of truth for ALL 7 mappings (zone + SecurePi edge)", () => {
    // config/detectionTypes.js owns the full mapping; utils/detectionAlertBridge.js
    // imports it once (no local redeclaration) — this asserts the mapping is complete.
    expect(INCIDENT_TYPE_BY_DETECTION_TYPE).toEqual({
      unattended_object: "UNATTENDED_OBJECT",
      crowd_density: "OVERCROWDING",
      unauthorized_access: "UNAUTHORIZED_ACCESS",
      pest_detection: "PEST_DETECTION",
      restricted_motion: "RESTRICTED_MOTION",
      forgotten_belonging: "FORGOTTEN_BELONGING",
      item_movement: "ITEM_MOVEMENT",
    });
  });

  test("zone validation stays limited to the three Detection Setup categories", () => {
    // Adding the edge categories to the mapping must NOT widen what a zone accepts.
    expect(DETECTION_TYPES).not.toContain("pest_detection");
    expect(DETECTION_TYPES).not.toContain("forgotten_belonging");
    expect(DETECTION_TYPES).toHaveLength(3);
  });
});

describe("detectionAlertBridge consumes the shared mapping", () => {
  const { resolveIncidentType } = require("../../utils/detectionAlertBridge");

  test.each([
    ["unattended_object", "UNATTENDED_OBJECT"],
    ["crowd_density", "OVERCROWDING"],
    ["unauthorized_access", "UNAUTHORIZED_ACCESS"],
    ["pest_detection", "PEST_DETECTION"],
    ["restricted_motion", "RESTRICTED_MOTION"],
    ["forgotten_belonging", "FORGOTTEN_BELONGING"],
    ["item_movement", "ITEM_MOVEMENT"],
  ])("explicit detection_type %s bridges to %s", (detection_type, incidentType) => {
    expect(resolveIncidentType({ detection_type })).toBe(incidentType);
  });
});
