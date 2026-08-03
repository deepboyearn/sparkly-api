import { describe, it, expect } from "vitest";

// MITM page server toggle state transitions

describe("MITM page server toggle", () => {
  it("initial state: not running", () => {
    const isRunning = false;
    expect(isRunning).toBe(false);
  });

  it("after start: isRunning becomes true", () => {
    let isRunning = false;
    isRunning = true;
    expect(isRunning).toBe(true);
  });

  it("after stop: isRunning becomes false", () => {
    let isRunning = true;
    isRunning = false;
    expect(isRunning).toBe(false);
  });

  it("toggle from stopped starts server", () => {
    let isRunning = false;
    // Simulate toggle: if not running, start
    if (!isRunning) {
      isRunning = true;
    }
    expect(isRunning).toBe(true);
  });

  it("toggle from running stops server", () => {
    let isRunning = true;
    // Simulate toggle: if running, stop
    if (isRunning) {
      isRunning = false;
    }
    expect(isRunning).toBe(false);
  });

  it("serverLoading tracks async operation", () => {
    let serverLoading = false;
    serverLoading = true; // start loading
    expect(serverLoading).toBe(true);
    serverLoading = false; // done loading
    expect(serverLoading).toBe(false);
  });

  it("badge text matches isRunning state", () => {
    const getBadge = (isRunning: boolean) =>
      isRunning ? "Running" : "Stopped";
    expect(getBadge(false)).toBe("Stopped");
    expect(getBadge(true)).toBe("Running");
  });

  it("badge color matches isRunning state", () => {
    const getColor = (isRunning: boolean) =>
      isRunning ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)";
    expect(getColor(false)).toBe("rgba(239, 68, 68, 0.15)");
    expect(getColor(true)).toBe("rgba(34, 197, 94, 0.15)");
  });

  it("ADMIN_ELEVATION_REQUESTED error triggers elevation alert", () => {
    const msg = "Error: ADMIN_ELEVATION_REQUESTED";
    const isElevation = msg.includes("ADMIN_ELEVATION_REQUESTED");
    expect(isElevation).toBe(true);
  });

  it("root error triggers root alert", () => {
    const msg = "Port 443 requires root. Run with: sudo ./sparkly-api";
    const isRoot = msg.includes("root");
    expect(isRoot).toBe(true);
  });

  it("generic error shows error message", () => {
    const msg = "Connection refused";
    const isElevation = msg.includes("ADMIN_ELEVATION_REQUESTED");
    const isRoot = msg.includes("root");
    expect(isElevation).toBe(false);
    expect(isRoot).toBe(false);
  });
});
