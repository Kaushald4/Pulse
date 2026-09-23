import { describe, expect, it } from "vitest";
import {
  buildTaxonomy,
  CATEGORY_OPTIONS,
  FIELD_OPTIONS,
  HEAD_KINDS,
  HEAD_VALUES,
  HEADS,
  SIGNAL_LEVELS,
  TAXONOMY_VERSION,
  TOPIC_OPTIONS,
  WHY_LABELS,
  WHY_OPTIONS,
} from "./taxonomy";

describe("taxonomy", () => {
  it("declares every head with a kind and a non-empty vocabulary", () => {
    for (const head of HEADS) {
      expect(HEAD_VALUES[head].length).toBeGreaterThan(1);
      expect(HEAD_KINDS[head]).toMatch(/^(choice|score|noul)$/);
    }
  });

  it("treats signal as ordinal rather than four unrelated classes", () => {
    expect(HEAD_KINDS.signal).toBe("score");
    expect(buildTaxonomy().signalOrdinal).toBe(true);
    expect(SIGNAL_LEVELS).toHaveLength(4);
  });

  it("has no duplicate values inside a head", () => {
    for (const head of HEADS) {
      const values = HEAD_VALUES[head];
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("labels every whyKey, so a rendered reason is never undefined", () => {
    for (const option of WHY_OPTIONS) expect(WHY_LABELS[option]).toBeTruthy();
    expect(WHY_LABELS.other).toBeTruthy();
  });

  it("includes the values finalize falls back to", () => {
    // finalize substitutes these when the model omits or invents a value, so a
    // fallback that is not in the vocabulary would be an off-vocabulary output
    // produced by our own code.
    expect(TOPIC_OPTIONS).toContain("other");
    expect(WHY_OPTIONS).toContain("other");
    expect(FIELD_OPTIONS).toContain("developer_tools");
    expect(CATEGORY_OPTIONS).toContain("news");
  });

  it("exports exactly the vocabulary the app accepts", () => {
    const exported = buildTaxonomy();
    expect(exported.version).toBe(TAXONOMY_VERSION);
    expect(exported.heads.category.values).toEqual([...CATEGORY_OPTIONS]);
    expect(exported.heads.field.values).toEqual(FIELD_OPTIONS);
    expect(exported.heads.topic.values).toEqual(TOPIC_OPTIONS);
    expect(exported.heads.signal.values).toEqual(SIGNAL_LEVELS);
    expect(exported.heads.whyKey.values).toEqual(WHY_OPTIONS);
    expect(exported.heads.primary.values).toEqual(["false", "true"]);

    for (const head of HEADS) {
      expect(exported.heads[head].cardinality).toBe(HEAD_VALUES[head].length);
    }
  });
});
