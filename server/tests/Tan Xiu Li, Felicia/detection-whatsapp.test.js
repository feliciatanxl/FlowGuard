// Security detection-alert WhatsApp: pure message builder, recipient resolution,
// severity gating, and send behaviour. These are a SEPARATE message family from
// the driver/booking notifications — they go to WHATSAPP_SECURITY_RECIPIENTS, never
// to a driver phone. No real WhatsApp calls (global.fetch is mocked).
const whatsapp = require("../../services/whatsappService");
const bridge = require("../../utils/detectionAlertBridge");

const KEYS = [
  "WHATSAPP_ENABLED", "WHATSAPP_API_URL", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_API_KEY",
  "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_SECURITY_RECIPIENTS", "WHATSAPP_DETECTION_MIN_SEVERITY",
  "FRONTEND_URL", "CLIENT_URL", "NODE_ENV",
];

let snapshot;
let origFetch;

beforeEach(() => {
  snapshot = {};
  KEYS.forEach((k) => { snapshot[k] = process.env[k]; delete process.env[k]; });
  origFetch = global.fetch;
});

afterEach(() => {
  KEYS.forEach((k) => {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  });
  global.fetch = origFetch;
  jest.restoreAllMocks();
});

const okFetch = () =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.X" }] }) });

const enableReal = () => {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_API_URL = "https://graph.facebook.com/v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAtoken1234567890";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PNID123";
};

const pestAlert = {
  alert_type: "Pest Detection", object_class: "rat", severity: "High",
  zone_name: "Kitchen", camera_location: "Kitchen Camera 01",
  occurred_at: "2026-07-29T08:46:00Z", confidence: 0.92, device_id: "securepi-kitchen-01",
  snapshot_url: "https://cdn.example.com/x.jpg",
};

const unattendedAlert = {
  alert_type: "Unattended Object", object_class: "backpack", severity: "High",
  zone_name: "Lobby", camera_location: "Lobby Camera 01", duration_seconds: 35,
  occurred_at: "2026-07-29T08:46:00Z", confidence: 0.88,
  snapshot_path: "runtime/snapshots/lobby/alert_bag12.jpg",
};

describe("buildDetectionAlertMessage (pure)", () => {
  test("pest heading + object class + Singapore timestamp + confidence %", () => {
    const msg = whatsapp.buildDetectionAlertMessage(pestAlert);
    expect(msg).toContain("🚨 FlowGuard Pest Alert");
    expect(msg).toContain("Object: Rat");
    expect(msg).toContain("Location: Kitchen");
    expect(msg).toContain("Camera: Kitchen Camera 01");
    expect(msg).toContain("Detected: 29 Jul 2026, 4:46 PM"); // Asia/Singapore, TZ-independent
    expect(msg).toContain("Confidence: 92%");
    expect(msg).toContain("Device: securepi-kitchen-01");
    expect(msg).toContain("Photo: https://cdn.example.com/x.jpg");
  });

  test("unattended-item heading includes duration line", () => {
    const msg = whatsapp.buildDetectionAlertMessage(unattendedAlert);
    expect(msg).toContain("🚨 FlowGuard Unattended Item Alert");
    expect(msg).toContain("Object: Backpack");
    expect(msg).toContain("Unattended for: 35 seconds");
  });

  test("headings differ by alert type", () => {
    const heading = (t) => whatsapp.buildDetectionAlertMessage({ alert_type: t }).split("\n")[0];
    expect(heading("Forgotten Belonging")).toBe("⚠️ FlowGuard Forgotten Belonging Alert");
    expect(heading("Restricted-Zone Motion")).toBe("🚨 FlowGuard Restricted-Zone Motion Alert");
    expect(heading("Item Picked Up")).toBe("⚠️ FlowGuard Item Movement Alert");
    expect(heading("Item Set Down")).toBe("⚠️ FlowGuard Item Movement Alert");
    expect(heading("PIR Motion Sensor")).toBe("⚠️ FlowGuard PIR Motion Sensor Alert");
    expect(heading("Ultrasonic Sensor")).toBe("⚠️ FlowGuard Ultrasonic Sensor Alert");
    expect(heading("PIR + Ultrasonic Sensor")).toBe("⚠️ FlowGuard Sensor Alert");
    expect(heading("Something Unknown")).toBe("🚨 FlowGuard Detection Alert");
  });

  test("a local snapshot path is NOT presented as a remote link", () => {
    const msg = whatsapp.buildDetectionAlertMessage(unattendedAlert);
    expect(msg).not.toContain("Photo: runtime/snapshots");
    expect(msg).not.toMatch(/Photo: .*runtime\/snapshots/);
    expect(msg).toContain("Photo captured on edge device; remote upload unavailable.");
  });

  test("a valid https snapshot URL is included as a Photo link", () => {
    const msg = whatsapp.buildDetectionAlertMessage({ ...pestAlert, snapshot_url: "https://ok.example/img.jpg" });
    expect(msg).toContain("Photo: https://ok.example/img.jpg");
  });

  test("sensor alerts include PIR and ultrasonic readings in the WhatsApp body", () => {
    const msg = whatsapp.buildDetectionAlertMessage({
      alert_type: "PIR + Ultrasonic Sensor",
      object_class: "combined sensor trigger",
      severity: "Medium",
      zone_name: "Loading Bay",
      camera_location: "Pi Camera Module 3",
      device_id: "securepi-pi4-01",
      sensor_metadata: {
        trigger: "pir_and_ultrasonic",
        motion: true,
        pir_ready: true,
        distance_cm: 18.46,
        distance_change_cm: 41.22,
        object_close: true,
        inspection_active: true,
      },
    });
    expect(msg).toContain("⚠️ FlowGuard Sensor Alert");
    expect(msg).toContain("Sensor trigger: PIR motion + ultrasonic distance change");
    expect(msg).toContain("PIR motion: Yes");
    expect(msg).toContain("PIR ready: Yes");
    expect(msg).toContain("Ultrasonic distance: 18.5 cm");
    expect(msg).toContain("Distance change: 41.2 cm");
    expect(msg).toContain("Object close: Yes");
    expect(msg).toContain("Inspection active: Yes");
  });

  test("pest alerts include SecurePi sensor aliases shown in the dashboard", () => {
    const msg = whatsapp.buildDetectionAlertMessage({
      alert_type: "Pest Detection",
      object_class: "rat",
      severity: "High",
      zone_name: "Demo",
      camera_location: "Loading Bay Camera 01",
      confidence: 0.62,
      device_id: "securepi-loading-bay-01",
      sensor_metadata: {
        pir: true,
        ultrasonic_cm: 5,
        distance_change_cm: 0,
        trigger: "PIR",
        after_hours: true,
      },
    });
    expect(msg).toContain("🚨 FlowGuard Pest Alert");
    expect(msg).toContain("Sensor trigger: PIR motion");
    expect(msg).toContain("PIR motion: Yes");
    expect(msg).toContain("Ultrasonic distance: 5 cm");
    expect(msg).toContain("Distance change: 0 cm");
    expect(msg).toContain("After hours: Yes");
  });

  test("handles missing optional fields safely and omits person 'UNKNOWN'", () => {
    const msg = whatsapp.buildDetectionAlertMessage({ alert_type: "Pest Detection", person_name: "UNKNOWN" });
    expect(typeof msg).toBe("string");
    expect(msg).not.toContain("Person:");
    expect(msg).not.toContain("Confidence:");
    expect(msg).not.toContain("Photo:");
  });

  test("includes a real person name when present", () => {
    const msg = whatsapp.buildDetectionAlertMessage({ alert_type: "Restricted-Zone Motion", person_name: "J. Tan" });
    expect(msg).toContain("Person: J. Tan");
  });

  test("dashboard link included only when a base URL is supplied", () => {
    expect(whatsapp.buildDetectionAlertMessage(pestAlert)).toContain("Review the event in the FlowGuard dashboard.");
    const withUrl = whatsapp.buildDetectionAlertMessage(pestAlert, { dashboardUrl: "https://app.example/object-detection" });
    expect(withUrl).toContain("https://app.example/object-detection");
  });
});

describe("severity gating", () => {
  test("Low < Medium < High < Critical ordering", () => {
    expect(whatsapp.severityRank("Low")).toBeLessThan(whatsapp.severityRank("Medium"));
    expect(whatsapp.severityRank("Medium")).toBeLessThan(whatsapp.severityRank("High"));
    expect(whatsapp.severityRank("High")).toBeLessThan(whatsapp.severityRank("Critical"));
    expect(whatsapp.meetsMinSeverity("High", "Medium")).toBe(true);
    expect(whatsapp.meetsMinSeverity("Low", "High")).toBe(false);
    expect(whatsapp.meetsMinSeverity("Low", undefined)).toBe(true); // default floor = Low
  });
});

describe("resolveDetectionRecipients", () => {
  test("normalizes and de-duplicates security numbers", () => {
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567, 6591234567 , 91234567, +65 9876 5432";
    expect(whatsapp.resolveDetectionRecipients()).toEqual(["6591234567", "6598765432"]);
  });
  test("returns [] when unset", () => {
    delete process.env.WHATSAPP_SECURITY_RECIPIENTS;
    expect(whatsapp.resolveDetectionRecipients()).toEqual([]);
  });
});

describe("sendDetectionAlert", () => {
  test("no recipients configured -> Skipped (never throws)", async () => {
    delete process.env.WHATSAPP_SECURITY_RECIPIENTS;
    const res = await whatsapp.sendDetectionAlert(pestAlert);
    expect(res.status).toBe("Skipped");
    expect(res.recipientCount).toBe(0);
  });

  test("mock mode -> Simulated, to the SECURITY recipients (never a driver phone)", async () => {
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567,6598765432";
    global.fetch = jest.fn(); // must NOT be called in mock mode
    const res = await whatsapp.sendDetectionAlert(pestAlert);
    expect(res.status).toBe("Simulated");
    expect(res.recipientCount).toBe(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("real mode success -> Sent, posts to each security recipient (not a driver phone)", async () => {
    enableReal();
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567,6598765432";
    global.fetch = okFetch();
    const res = await whatsapp.sendDetectionAlert(pestAlert);
    expect(res.status).toBe("Sent");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const recipients = global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body).to);
    expect(recipients.sort()).toEqual(["6591234567", "6598765432"]);
    // The driver-pass number used elsewhere must never receive a security alert.
    expect(recipients).not.toContain("6590000001");
    // The body carries the security heading, never booking/driver-pass content.
    const body = JSON.parse(global.fetch.mock.calls[0][1].body).text.body;
    expect(body).toContain("FlowGuard Pest Alert");
    expect(body).not.toMatch(/driver pass|loading bay|plate/i);
  });

  test("Meta API failure -> Failed (safe, non-throwing)", async () => {
    enableReal();
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid recipient" } }) });
    const res = await whatsapp.sendDetectionAlert(pestAlert);
    expect(res.status).toBe("Failed");
  });

  test("does not log the access token or a full recipient number", async () => {
    enableReal();
    process.env.WHATSAPP_SECURITY_RECIPIENTS = "6591234567";
    global.fetch = okFetch();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await whatsapp.sendDetectionAlert(pestAlert);
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain("EAAtoken1234567890");
    expect(logged).not.toContain("6591234567");
  });
});

describe("detection -> incident bridge (edge types do not collapse to UNATTENDED_OBJECT)", () => {
  test("pest maps to PEST_DETECTION", () => {
    expect(bridge.resolveIncidentType({ alert_type: "Pest Detection", object_class: "rat" })).toBe("PEST_DETECTION");
    expect(bridge.resolveIncidentType({ object_class: "mouse" })).toBe("PEST_DETECTION");
    expect(bridge.resolveIncidentType({ detection_type: "pest_detection", object_class: "backpack" })).toBe("PEST_DETECTION");
  });
  test("restricted motion maps to RESTRICTED_MOTION", () => {
    expect(bridge.resolveIncidentType({ alert_type: "Restricted-Zone Motion" })).toBe("RESTRICTED_MOTION");
    expect(bridge.resolveIncidentType({ alert_type: "After-hours motion" })).toBe("RESTRICTED_MOTION");
    expect(bridge.resolveIncidentType({ detection_type: "restricted_motion" })).toBe("RESTRICTED_MOTION");
  });
  test("existing mappings still hold", () => {
    expect(bridge.resolveIncidentType({ object_class: "backpack" })).toBe("UNATTENDED_OBJECT");
    expect(bridge.resolveIncidentType({ object_class: "Warning: 3 People Detected" })).toBe("OVERCROWDING");
    expect(bridge.resolveIncidentType({ alert_type: "Unauthorized Access" })).toBe("UNAUTHORIZED_ACCESS");
  });
});
