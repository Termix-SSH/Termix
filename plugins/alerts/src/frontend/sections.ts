export type Section = "inbox" | "channels" | "rules";

/** Lets an action open the tab on a given section. */
export function createSectionRequests() {
  let pending: Section | null = null;
  const listeners = new Set<(section: Section) => void>();
  return {
    request(section: Section) {
      pending = section;
      for (const listener of listeners) listener(section);
    },
    take(): Section | null {
      const section = pending;
      pending = null;
      return section;
    },
    subscribe(listener: (section: Section) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SectionRequests = ReturnType<typeof createSectionRequests>;
