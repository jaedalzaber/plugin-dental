import { describe, expect, it } from "vitest";
import {
  ADULT_TEETH,
  ALL_TEETH,
  CHILD_TEETH,
  canonicalSurfaces,
  dentitionOf,
  fdiToUniversal,
  formatTooth,
  isAnterior,
  isValidTooth,
  surfaceLetters,
  toothNumberingOf,
  toothType,
  universalToFdi,
} from "./teeth";

describe("tooth lists", () => {
  it("has 32 adult and 20 child teeth, all valid and unique", () => {
    expect(ADULT_TEETH).toHaveLength(32);
    expect(CHILD_TEETH).toHaveLength(20);
    expect(new Set(ALL_TEETH).size).toBe(52);
    expect(ALL_TEETH.every(isValidTooth)).toBe(true);
    expect(ADULT_TEETH.slice(0, 8)).toEqual(["11", "12", "13", "14", "15", "16", "17", "18"]);
    expect(CHILD_TEETH.slice(-5)).toEqual(["81", "82", "83", "84", "85"]);
  });

  it("rejects anything that is not an FDI tooth number", () => {
    for (const bad of ["", "0", "1", "10", "19", "29", "39", "49", "56", "66", "76", "86", "90", "111", "1A", "A", " 11", "11 ", "abc"]) {
      expect(isValidTooth(bad), bad).toBe(false);
    }
    expect(isValidTooth(11)).toBe(false);
    expect(isValidTooth(null)).toBe(false);
    expect(isValidTooth(undefined)).toBe(false);
  });

  it("tells adult from child teeth", () => {
    expect(dentitionOf("16")).toBe("adult");
    expect(dentitionOf("55")).toBe("child");
  });
});

describe("FDI <-> Universal", () => {
  it("round-trips every tooth", () => {
    for (const fdi of ALL_TEETH) {
      expect(universalToFdi(fdiToUniversal(fdi)), fdi).toBe(fdi);
    }
  });

  it("maps adult teeth to 1-32 without gaps or repeats", () => {
    const numbers = ADULT_TEETH.map((fdi) => Number(fdiToUniversal(fdi))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it("maps child teeth to A-T without gaps or repeats", () => {
    const letters = CHILD_TEETH.map(fdiToUniversal).sort();
    expect(letters).toEqual("ABCDEFGHIJKLMNOPQRST".split(""));
  });

  it.each([
    ["18", "1"],
    ["11", "8"],
    ["21", "9"],
    ["28", "16"],
    ["38", "17"],
    ["31", "24"],
    ["41", "25"],
    ["48", "32"],
    ["16", "3"],
    ["46", "30"],
    ["55", "A"],
    ["51", "E"],
    ["61", "F"],
    ["65", "J"],
    ["75", "K"],
    ["71", "O"],
    ["81", "P"],
    ["85", "T"],
  ])("FDI %s is Universal %s", (fdi, universal) => {
    expect(fdiToUniversal(fdi)).toBe(universal);
    expect(universalToFdi(universal)).toBe(fdi);
  });

  it("reads lower case letters and padded text", () => {
    expect(universalToFdi("a")).toBe("55");
    expect(universalToFdi(" 32 ")).toBe("48");
  });

  it("rejects invalid FDI numbers", () => {
    for (const bad of ["19", "0", "", "A", "1", "56", "49", "100"]) {
      expect(() => fdiToUniversal(bad), bad).toThrow(RangeError);
    }
  });

  it("rejects invalid Universal numbers", () => {
    for (const bad of ["0", "33", "01", "U", "AA", "", "-1", "1.5", "x"]) {
      expect(() => universalToFdi(bad), bad).toThrow(RangeError);
    }
  });

  it("shows the number the clinic chose", () => {
    expect(formatTooth("16", "fdi")).toBe("16");
    expect(formatTooth("16", "universal")).toBe("3");
    expect(toothNumberingOf("universal")).toBe("universal");
    expect(toothNumberingOf("fdi")).toBe("fdi");
    expect(toothNumberingOf(undefined)).toBe("fdi");
    expect(toothNumberingOf("other")).toBe("fdi");
  });
});

describe("tooth type and surfaces", () => {
  it("classifies teeth", () => {
    expect(toothType("11")).toBe("incisor");
    expect(toothType("23")).toBe("canine");
    expect(toothType("34")).toBe("premolar");
    expect(toothType("46")).toBe("molar");
    expect(toothType("54")).toBe("molar");
    expect(isAnterior("42")).toBe(true);
    expect(isAnterior("16")).toBe(false);
  });

  it("names the surfaces by tooth", () => {
    expect(surfaceLetters("16")).toEqual({ mesial: "M", distal: "D", occlusal: "O", buccal: "B", lingual: "P" });
    expect(surfaceLetters("36")).toEqual({ mesial: "M", distal: "D", occlusal: "O", buccal: "B", lingual: "L" });
    expect(surfaceLetters("11")).toEqual({ mesial: "M", distal: "D", occlusal: "I", buccal: "F", lingual: "P" });
    expect(surfaceLetters("43")).toEqual({ mesial: "M", distal: "D", occlusal: "I", buccal: "F", lingual: "L" });
  });

  it("rewrites surface letters to the tooth's own, in display order, without duplicates", () => {
    expect(canonicalSurfaces("16", ["D", "o", "M", "O"])).toEqual(["M", "O", "D"]);
    expect(canonicalSurfaces("11", ["O", "B", "L"])).toEqual(["I", "F", "P"]);
    expect(canonicalSurfaces("36", ["P", "F"])).toEqual(["B", "L"]);
    expect(canonicalSurfaces("16", [])).toEqual([]);
  });

  it("rejects unknown surface letters and bad teeth", () => {
    expect(() => canonicalSurfaces("16", ["X"])).toThrow(RangeError);
    expect(() => canonicalSurfaces("16", ["MO"])).toThrow(RangeError);
    expect(() => canonicalSurfaces("19", ["M"])).toThrow(RangeError);
  });
});
