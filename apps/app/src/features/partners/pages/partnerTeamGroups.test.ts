import { describe, it, expect } from "vitest";
import { groupPartnersByTeam } from "./partnerTeamGroups";
import type { Team } from "@/features/scope/teams";
import type { Partner } from "../mockData";

function p(id: string, ownerId: string | null): Partner {
  return {
    id, name: id, company: id, type: "cpa_bookkeeper", status: "active",
    phone: "", email: "", city: "", lastTouch: null, nextFollowup: null,
    attributedDealIds: [], outboundDealIds: [], notes: "", ownerId,
  } as Partner;
}

const teams: Team[] = [
  { id: "mgrA", name: "Alpha", memberIds: ["mgrA", "a1"] },
  { id: "mgrB", name: "Bravo", memberIds: ["mgrB", "b1"] },
];

describe("groupPartnersByTeam", () => {
  it("buckets partners under their owner's team, in team order, with subtotals", () => {
    const groups = groupPartnersByTeam(
      [p("p1", "a1"), p("p2", "mgrB"), p("p3", "b1")],
      teams,
      "dir",
    );
    expect(groups.map((g) => g.name)).toEqual(["Alpha", "Bravo"]);
    expect(groups[0].partners.map((x) => x.id)).toEqual(["p1"]);
    expect(groups[1].partners.map((x) => x.id)).toEqual(["p2", "p3"]);
  });

  it("routes the viewer's own partners to 'You' and strangers to 'Other', last", () => {
    const groups = groupPartnersByTeam(
      [p("mine", "dir"), p("stray", "someone-else"), p("teamed", "a1")],
      teams,
      "dir",
    );
    expect(groups.map((g) => g.name)).toEqual(["Alpha", "You", "Other"]);
    expect(groups.find((g) => g.name === "You")!.partners[0].id).toBe("mine");
    expect(groups.find((g) => g.name === "Other")!.partners[0].id).toBe("stray");
  });

  it("omits empty team groups", () => {
    const groups = groupPartnersByTeam([p("p1", "a1")], teams, "dir");
    expect(groups.map((g) => g.name)).toEqual(["Alpha"]);
  });
});
