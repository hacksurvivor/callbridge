export type TravelerRequirement = {
  label: string;
  disclosure: "always" | "only_when_relevant";
};

export type TravelerGroup = {
  name: string;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  requirements: TravelerRequirement[];
};

export function validateTravelerGroup(group: TravelerGroup): TravelerGroup {
  if (!group.name.trim()) throw new Error("Traveler group needs a name");
  for (const value of [group.adults, group.children, group.infants, group.pets]) {
    if (!Number.isInteger(value) || value < 0 || value > 30) {
      throw new Error("Traveler counts must be integers from 0 to 30");
    }
  }
  if (group.adults + group.children + group.infants < 1) {
    throw new Error("A traveler group needs at least one person");
  }
  if (group.requirements.some((item) => !item.label.trim())) {
    throw new Error("Traveler requirements cannot be blank");
  }
  return group;
}

/** A task receives a copy, never a live link, so a later profile edit is safe. */
export function taskDetailsFromTravelerGroup(group: TravelerGroup): Record<string, string | number | string[]> {
  validateTravelerGroup(group);
  return {
    adults: group.adults,
    children: group.children,
    infants: group.infants,
    pets: group.pets,
    required_traveler_requirements: group.requirements
      .filter((item) => item.disclosure === "always")
      .map((item) => item.label),
    contextual_traveler_preferences: group.requirements
      .filter((item) => item.disclosure === "only_when_relevant")
      .map((item) => item.label),
  };
}
