import { describe, expect, it } from "vitest";
import {
  parseSensorsOutput,
  parseSysfsThermalOutput,
} from "./temperature-collector.js";

describe("temperature collectors", () => {
  it("parses sysfs thermal zone output", () => {
    const result = parseSysfsThermalOutput(
      "x86_pkg_temp\t51000\nacpitz\t42\nbad\tnope\n",
    );

    expect(result).toEqual([
      { label: "x86_pkg_temp", celsius: 51 },
      { label: "acpitz", celsius: 42 },
    ]);
  });

  it("parses lm-sensors temperature lines", () => {
    const result = parseSensorsOutput(`
coretemp-isa-0000
Adapter: ISA adapter
Package id 0:  +52.0°C  (high = +80.0°C, crit = +100.0°C)
Core 0:        +48.5°C
fan1:          1200 RPM
`);

    expect(result).toEqual([
      { label: "Package id 0", celsius: 52 },
      { label: "Core 0", celsius: 48.5 },
    ]);
  });
});
