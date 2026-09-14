/**
 * The admin breadcrumb trail for a URL, one crumb per path segment. Plain and
 * client-safe on purpose: the header works it out on every navigation, and it
 * runs under node for the self-check below.
 */
export type Crumb = { label: string; href: string | null };

// An id has no name in the URL, so it gets its section's word for one thing.
const ID_LABELS: Record<string, string> = {
  members: "Μέλος",
  bookings: "Παρουσίες",
  memberships: "Συνδρομή",
  schedule: "Μάθημα",
  plans: "Πακέτο",
  "class-types": "Τύπος μαθήματος",
};

// ponytail: only these sections have a page at their id. The rest go straight
// to /update, so /schedule/12 would 404 as a link. Add a section when its page lands.
const ID_HAS_PAGE = new Set(["members", "bookings"]);

const ACTIONS: Record<string, string> = {
  create: "Προσθήκη",
  update: "Επεξεργασία",
};

/**
 * `labels` names the sections, keyed by their URL segment. The last crumb is
 * the page itself and never a link.
 */
export function crumbs(
  pathname: string,
  labels: Record<string, string>,
): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, i) => {
    const parent = segments[i - 1];
    const isId = /^\d+$/.test(segment);
    const label = isId
      ? (ID_LABELS[parent] ?? segment)
      : (labels[segment] ?? ACTIONS[segment] ?? segment);
    const linkable =
      i < segments.length - 1 && (!isId || ID_HAS_PAGE.has(parent));
    return {
      label,
      href: linkable ? `/${segments.slice(0, i + 1).join("/")}` : null,
    };
  });
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  const labels = { members: "Μέλη", schedule: "Πρόγραμμα" };
  const trail = (p: string) =>
    crumbs(p, labels)
      .map((c) => (c.href ? `${c.label}@${c.href}` : c.label))
      .join(" / ");

  check(trail("/members") === "Μέλη", "a section alone is the page, not a link");
  check(
    trail("/members/create") === "Μέλη@/members / Προσθήκη",
    "create links back to its section",
  );
  check(
    trail("/members/12/update") ===
      "Μέλη@/members / Μέλος@/members/12 / Επεξεργασία",
    "a member id links to the member's page",
  );
  check(
    trail("/schedule/7/update") === "Πρόγραμμα@/schedule / Μάθημα / Επεξεργασία",
    "a class id has no page, so it is not a link",
  );
  check(trail("/") === "", "the root has no crumbs");

  console.log("breadcrumbs self-check passed");
}
