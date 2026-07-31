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
});
