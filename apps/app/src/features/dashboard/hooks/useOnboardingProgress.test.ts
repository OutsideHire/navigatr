import { describe, it, expect } from "vitest";
import {
  deriveOnboardingSteps,
  allStepsComplete,
  type OnboardingCounts,
} from "./useOnboardingProgress";

const counts = (over: Partial<OnboardingCounts> = {}): OnboardingCounts => ({
  invitesSent: 0,
  orgMemberCount: 0,
  orgActivityCount: 0,
  orgDealCount: 0,
  ...over,
});

const step = (steps: ReturnType<typeof deriveOnboardingSteps>, key: string) =>
  steps.find((s) => s.key === key)!;

describe("deriveOnboardingSteps", () => {
  it("marks workspace done and invite the emphasized activation step", () => {
    const s = deriveOnboardingSteps(counts());
    expect(step(s, "workspace").done).toBe(true);
    expect(step(s, "invite").emphasized).toBe(true);
    expect(step(s, "invite").ctaTo).toBe("/welcome");
  });

  it("a brand-new org has only workspace done", () => {
    const s = deriveOnboardingSteps(counts());
    expect(step(s, "invite").done).toBe(false);
    expect(step(s, "teammate").done).toBe(false);
    expect(step(s, "activity").done).toBe(false);
    expect(allStepsComplete(s)).toBe(false);
  });

  it("invite is done at exactly one invite sent (boundary)", () => {
    expect(step(deriveOnboardingSteps(counts({ invitesSent: 0 })), "invite").done).toBe(false);
    expect(step(deriveOnboardingSteps(counts({ invitesSent: 1 })), "invite").done).toBe(true);
  });

  it("teammate is done at two org members, not one (the admin alone)", () => {
    expect(step(deriveOnboardingSteps(counts({ orgMemberCount: 1 })), "teammate").done).toBe(false);
    expect(step(deriveOnboardingSteps(counts({ orgMemberCount: 2 })), "teammate").done).toBe(true);
  });

  it("activity is done on a first activity OR a first deal", () => {
    expect(step(deriveOnboardingSteps(counts()), "activity").done).toBe(false);
    expect(step(deriveOnboardingSteps(counts({ orgActivityCount: 1 })), "activity").done).toBe(true);
    expect(step(deriveOnboardingSteps(counts({ orgDealCount: 1 })), "activity").done).toBe(true);
  });

  it("allStepsComplete only when every count threshold is met", () => {
    const full = counts({ invitesSent: 3, orgMemberCount: 5, orgActivityCount: 10, orgDealCount: 4 });
    expect(allStepsComplete(deriveOnboardingSteps(full))).toBe(true);
    // Missing just the teammate step keeps it incomplete.
    const almost = counts({ invitesSent: 3, orgMemberCount: 1, orgDealCount: 4 });
    expect(allStepsComplete(deriveOnboardingSteps(almost))).toBe(false);
  });
});
