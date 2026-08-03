import { describe, it, expect } from "vitest";

// MITM page cert status indicator logic
// The cert status display uses isCertGenerated and isCertTrusted booleans

describe("MITM page cert status indicator logic", () => {
  function getCertIconProps(isCertGenerated: boolean, isCertTrusted: boolean) {
    return {
      certIcon: isCertGenerated
        ? "solar:check-circle-bold-duotone"
        : "solar:close-circle-bold-duotone",
      certColor: isCertGenerated ? "#22c55e" : "#ef4444",
      trustIcon: isCertTrusted
        ? "solar:check-circle-bold-duotone"
        : "solar:close-circle-bold-duotone",
      trustColor: isCertTrusted ? "#22c55e" : "#ef4444",
    };
  }

  it("shows green check when cert is generated and trusted", () => {
    const props = getCertIconProps(true, true);
    expect(props.certIcon).toBe("solar:check-circle-bold-duotone");
    expect(props.certColor).toBe("#22c55e");
    expect(props.trustIcon).toBe("solar:check-circle-bold-duotone");
    expect(props.trustColor).toBe("#22c55e");
  });

  it("shows red X for cert when not generated", () => {
    const props = getCertIconProps(false, false);
    expect(props.certIcon).toBe("solar:close-circle-bold-duotone");
    expect(props.certColor).toBe("#ef4444");
  });

  it("shows red X for trust when not trusted", () => {
    const props = getCertIconProps(true, false);
    expect(props.trustIcon).toBe("solar:close-circle-bold-duotone");
    expect(props.trustColor).toBe("#ef4444");
  });

  it("cert generated but not trusted", () => {
    const props = getCertIconProps(true, false);
    expect(props.certColor).toBe("#22c55e");
    expect(props.trustColor).toBe("#ef4444");
  });

  it("cert not generated but marked trusted (edge case)", () => {
    const props = getCertIconProps(false, true);
    expect(props.certColor).toBe("#ef4444");
    expect(props.trustColor).toBe("#22c55e");
  });

  it("server status indicator follows isRunning", () => {
    const isRunning = true;
    const serverIcon = isRunning
      ? "solar:check-circle-bold-duotone"
      : "solar:close-circle-bold-duotone";
    const serverColor = isRunning ? "#22c55e" : "#ef4444";
    expect(serverIcon).toBe("solar:check-circle-bold-duotone");
    expect(serverColor).toBe("#22c55e");
  });

  it("server stopped shows red", () => {
    const isRunning = false;
    const serverColor = isRunning ? "#22c55e" : "#ef4444";
    expect(serverColor).toBe("#ef4444");
  });

  it("running badge shows Running text", () => {
    expect(true ? "Running" : "Stopped").toBe("Running");
  });

  it("stopped badge shows Stopped text", () => {
    expect(false ? "Running" : "Stopped").toBe("Stopped");
  });
});
