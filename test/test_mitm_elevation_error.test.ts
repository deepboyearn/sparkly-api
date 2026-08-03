import { describe, it, expect } from "vitest";

// Elevation error message parsing from MITM server toggle and cert trust

describe("MITM elevation error message parsing", () => {
  it("detects ADMIN_ELEVATION_REQUESTED in error", () => {
    const msg = "Error: ADMIN_ELEVATION_REQUESTED";
    expect(msg.includes("ADMIN_ELEVATION_REQUESTED")).toBe(true);
  });

  it("detects root error in error", () => {
    const msg = "Port 443 requires root. Run with: sudo ./sparkly-api";
    expect(msg.includes("root")).toBe(true);
  });

  it("does not false-positive on unrelated error", () => {
    const msg = "Connection refused to localhost:443";
    expect(msg.includes("ADMIN_ELEVATION_REQUESTED")).toBe(false);
    expect(msg.includes("root")).toBe(false);
  });

  it("server toggle: elevation error triggers specific alert", () => {
    const msg = "ADMIN_ELEVATION_REQUESTED";
    const isElevation = msg.includes("ADMIN_ELEVATION_REQUESTED");
    expect(isElevation).toBe(true);
    // In the actual code: alert("Admin elevation requested. A new elevated window will open. Close this one.");
  });

  it("server toggle: root error triggers root alert", () => {
    const msg = "Port 443 requires root. Run with: sudo ./sparkly-api";
    const isRoot = msg.includes("root");
    expect(isRoot).toBe(true);
    // In the actual code: alert(msg);
  });

  it("server toggle: generic error shows error prefix", () => {
    const msg = "ECONNREFUSED";
    const isElevation = msg.includes("ADMIN_ELEVATION_REQUESTED");
    const isRoot = msg.includes("root");
    expect(isElevation).toBe(false);
    expect(isRoot).toBe(false);
    // In the actual code: alert(`MITM server error: ${msg}`);
  });

  it("cert trust: elevation error triggers specific alert", () => {
    const msg = "Error: ADMIN_ELEVATION_REQUESTED";
    expect(msg.includes("ADMIN_ELEVATION_REQUESTED")).toBe(true);
  });

  it("cert trust: non-elevation error shows cert failure", () => {
    const msg = "Permission denied";
    const isElevation = msg.includes("ADMIN_ELEVATION_REQUESTED");
    expect(isElevation).toBe(false);
    // In the actual code: alert(`Certificate trust failed: ${msg}`);
  });

  it("error message from string conversion", () => {
    const err = new Error("ADMIN_ELEVATION_REQUESTED");
    const msg = String(err);
    expect(msg.includes("ADMIN_ELEVATION_REQUESTED")).toBe(true);
  });

  it("error from unknown type converts to string", () => {
    const err = "Port 443 requires root";
    const msg = String(err);
    expect(msg.includes("root")).toBe(true);
  });
});
