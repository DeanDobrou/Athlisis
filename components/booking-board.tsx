"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, ClipboardCheck, Plus } from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  startTransition,
  useOptimistic,
  useRef,
  useState,
} from "react";

import {
  bookMemberAction,
  cancelBookingAction,
  moveBookingAction,
} from "@/app/actions/bookings";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ClassSession, WeekBooking } from "@/lib/class-sessions";
import { formatDate, weekdayName } from "@/lib/gym-time";
import { SLOTS } from "@/lib/slots";
import { attempt, cn } from "@/lib/utils";

type Member = { id: string; name: string };

type Change =
  | { type: "move"; bookingId: string; to: string }
  | { type: "remove"; bookingId: string };

/**
 * Greek names compared the way member search does on the server: accents off,
 * final sigma folded, so "μαρια" finds Μαρία.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ");
}

function label(c: ClassSession): string {
  return `${weekdayName(c.day)} ${c.start_time}-${c.end_time}`;
}

/**
 * The week of classes as a board: rows are the gym's fixed slots, columns the
 * days, members sit inside their class. Dragging a member to another class is
 * the only way to move a booking; tapping a member cancels it, after asking;
 * + adds someone.
 *
 * Moves and cancellations show at once and settle when the server answers.
 * If the server refuses, the transition ends without the page refreshing, so
 * useOptimistic falls back to the real bookings and the member is back where
 * they were, with the reason in a toast. The rules checked here are only the
 * ones the board can see; lib/bookings.ts decides, including whether the
 * paying membership covers the new day.
 */
export function BookingBoard({
  days,
  classes,
  bookings,
  members,
  today,
}: {
  days: string[];
  classes: ClassSession[];
  bookings: WeekBooking[];
  members: Member[];
  today: string;
}) {
  const [shown, applyChange] = useOptimistic(
    bookings,
    (state: WeekBooking[], change: Change) =>
      change.type === "move"
        ? state.map((b) =>
            b.id === change.bookingId ? { ...b, session_id: change.to } : b,
          )
        : state.filter((b) => b.id !== change.bookingId),
  );
  const [dragging, setDragging] = useState<WeekBooking | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toCancel, setToCancel] = useState<WeekBooking | null>(null);
  const isMobile = useIsMobile();

  const justDragged = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
  );

  const classById = new Map(classes.map((c) => [c.id, c]));
  const inClass = (classId: string) =>
    shown.filter((b) => b.session_id === classId);

  function refusal(booking: WeekBooking, target: ClassSession): string | null {
    if (target.id === booking.session_id) return null;
    if (target.status === "cancelled") return "Το μάθημα έχει ακυρωθεί.";
    if (inClass(target.id).length >= target.capacity) {
      return "Το μάθημα είναι γεμάτο.";
    }
    const sameDay = shown.some(
      (b) =>
        b.id !== booking.id &&
        b.user_id === booking.user_id &&
        classById.get(b.session_id)?.day === target.day,
    );
    if (sameDay) return "Το μέλος έχει ήδη κράτηση εκείνη την ημέρα.";
    return null;
  }

  function move(booking: WeekBooking, target: ClassSession) {
    if (target.id === booking.session_id) return;
    const why = refusal(booking, target);
    if (why) {
      toast.error(why);
      return;
    }
    send(booking, target, classById.get(booking.session_id));
  }

  /**
   * Shows a move at once and saves it, offering Undo back to `back`. Undo
   * comes here directly rather than through refusal(): by the time anyone
   * presses it this render's view of the board is stale, and the server
   * checks the move anyway.
   */
  function send(booking: WeekBooking, target: ClassSession, back?: ClassSession) {
    startTransition(async () => {
      applyChange({ type: "move", bookingId: booking.id, to: target.id });
      const result = await attempt(() =>
        moveBookingAction(booking.id, target.id),
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.info(
        `${booking.member_name}: ${label(target)}`,
        back && { label: "Αναίρεση", onClick: () => send(booking, back) },
      );
    });
  }

  function cancel(booking: WeekBooking) {
    startTransition(async () => {
      applyChange({ type: "remove", bookingId: booking.id });
      const result = await attempt(() => cancelBookingAction(booking.id));
      if ("error" in result) {
        toast.error(result.error);
      } else {
        const done = `Η κράτηση για ${booking.member_name} ακυρώθηκε.`;
        toast.info(result.notice ? `${done} ${result.notice}` : done);
      }
    });
  }

  function add(member: Member, target: ClassSession) {
    setAddingTo(null);
    startTransition(async () => {
      const result = await attempt(() =>
        bookMemberAction(member.id, target.id),
      );
      if ("error" in result) toast.error(result.error);
      else toast.info(result.notice ?? `${member.name}: ${label(target)}`);
    });
  }

  function onDragStart(event: DragStartEvent) {
    setDragging(shown.find((b) => b.id === String(event.active.id)) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    const booking = dragging;
    setDragging(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    const target = event.over ? classById.get(String(event.over.id)) : null;
    if (booking && target) move(booking, target);
  }

  function tapBooking(booking: WeekBooking) {
    if (justDragged.current) return;
    setToCancel(booking);
    setConfirming(true);
  }

  const addClass = addingTo ? classById.get(addingTo) : undefined;
  const cancelClass = toCancel ? classById.get(toCancel.session_id) : undefined;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Πάτησε το μέλος για ακύρωση της κράτησης. Η μετακίνηση γίνεται μόνο με σύρσιμο.",
          },
        }}
      >
        <div className="overflow-x-auto pb-2">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(10rem, 1fr))`,
            }}
          >
            {days.map((day) => (
              <div
                key={day}
                className={cn(
                  "px-1 text-sm font-medium",
                  day === today && "text-primary",
                )}
              >
                {weekdayName(day)}{" "}
                <span className="text-muted-foreground font-normal">
                  {formatDate(day)}
                </span>
              </div>
            ))}

            {SLOTS.map((slot) => (
              <Fragment key={slot.start}>
                {days.map((day) => {
                  const cls = classes.find(
                    (c) => c.day === day && c.start_time === slot.start,
                  );
                  if (!cls) {
                    return (
                      <div
                        key={day}
                        aria-hidden="true"
                        className="min-h-28 rounded-md border border-dashed"
                      />
                    );
                  }
                  return (
                    <ClassCell
                      key={day}
                      cls={cls}
                      bookings={inClass(cls.id)}
                      dragging={dragging !== null}
                      isHome={dragging?.session_id === cls.id}
                      why={dragging ? refusal(dragging, cls) : null}
                      onTap={tapBooking}
                      onAdd={() => setAddingTo(cls.id)}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>

        <DragOverlay>
          {dragging && (
            <div className="bg-background flex items-center gap-1.5 rounded border px-2 py-1 text-xs shadow-lg">
              <ChipLabel booking={dragging} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Sheet
        open={addingTo !== null}
        onOpenChange={(open) => {
          if (!open) setAddingTo(null);
        }}
      >
        <SheetContent side={isMobile ? "bottom" : "right"}>
          {addClass && (
            <AddSheet
              cls={addClass}
              members={members.filter(
                (m) => !inClass(addClass.id).some((b) => b.user_id === m.id),
              )}
              onPick={(member) => add(member, addClass)}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Ακύρωση κράτησης;"
        description={`${toCancel?.member_name ?? ""}${cancelClass ? `, ${label(cancelClass)}` : ""}`}
        confirmLabel="Ακύρωση κράτησης"
        onConfirm={() => {
          if (toCancel) cancel(toCancel);
        }}
      />
    </>
  );
}

function ClassCell({
  cls,
  bookings,
  dragging,
  isHome,
  why,
  onTap,
  onAdd,
}: {
  cls: ClassSession;
  bookings: WeekBooking[];
  dragging: boolean;
  isHome: boolean;
  why: string | null;
  onTap: (booking: WeekBooking) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cls.id });
  const count = bookings.length;
  const cancelled = cls.status === "cancelled";
  const canDrop = dragging && !isHome && why === null;
  const refused = dragging && why !== null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-28 flex-col rounded-md border p-2 transition-colors",
        cls.is_past && "bg-muted/30",
        cancelled && "opacity-60",
        refused && "opacity-50",
        canDrop && "border-primary/40",
        isOver && canDrop && "bg-accent ring-2 ring-primary",
        isOver && refused && "ring-2 ring-destructive/60",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium tabular-nums">
          {cls.start_time}-{cls.end_time}
        </span>
        <span
          className={cn(
            "text-xs tabular-nums",
            count >= cls.capacity ? "font-semibold" : "text-muted-foreground",
          )}
        >
          {count}/{cls.capacity}
        </span>
      </div>

      {cls.types.length > 0 && (
        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {cls.types.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: t.color_hex ?? "transparent" }}
              />
              {t.name}
            </span>
          ))}
        </p>
      )}
      {cancelled && <p className="text-destructive text-xs">Ακυρωμένο</p>}
      {isOver && refused && (
        <p className="text-destructive mt-1 text-xs">{why}</p>
      )}

      <ul className="mt-2 flex flex-1 flex-col gap-1">
        {bookings.map((b) => (
          <MemberChip key={b.id} booking={b} onTap={() => onTap(b)} />
        ))}
      </ul>

      <div className="mt-1 flex items-center gap-1">
        {!cancelled && count < cls.capacity && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onAdd}
            aria-label={`Προσθήκη μέλους, ${label(cls)}`}
            title="Προσθήκη μέλους"
          >
            <Plus />
          </Button>
        )}
        {count > 0 && (
          <Link
            href={`/bookings/${cls.id}`}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={`Παρουσίες, ${label(cls)}`}
            title="Παρουσίες"
          >
            <ClipboardCheck />
          </Link>
        )}
      </div>
    </div>
  );
}

function MemberChip({
  booking,
  onTap,
}: {
  booking: WeekBooking;
  onTap: () => void;
}) {
  const active = booking.status === "booked";
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: booking.id,
    disabled: !active,
  });
  const chip =
    "bg-secondary flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs select-none [-webkit-touch-callout:none]";

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      className={cn(isDragging && "opacity-40")}
    >
      {active ? (
        <button
          type="button"
          onClick={onTap}
          aria-label={`Ακύρωση κράτησης: ${booking.member_name}${booking.unpaid ? ", ανεξόφλητη" : ""}`}
          title="Πάτησε για ακύρωση, σύρε για μετακίνηση"
          className={cn(chip, "hover:bg-accent cursor-grab")}
        >
          <ChipLabel booking={booking} />
        </button>
      ) : (
        <div className={chip}>
          <ChipLabel booking={booking} />
        </div>
      )}
    </li>
  );
}

function ChipLabel({ booking }: { booking: WeekBooking }) {
  return (
    <>
      <span className="truncate">{booking.member_name}</span>
      {booking.unpaid && (
        <>
          <span
            aria-hidden="true"
            className="bg-primary size-2 shrink-0 rounded-full"
          />
          <span className="sr-only">Ανεξόφλητη</span>
        </>
      )}
      {booking.status === "checked_in" && (
        <span
          className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400"
          title="Έγινε check-in"
        >
          <Check className="size-3.5 md:hidden" aria-hidden="true" />
          <span className="hidden md:inline">Check-in</span>
          <span className="sr-only md:hidden">Έγινε check-in</span>
        </span>
      )}
    </>
  );
}

function AddSheet({
  cls,
  members,
  onPick,
}: {
  cls: ClassSession;
  members: Member[];
  onPick: (member: Member) => void;
}) {
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const matches = q ? members.filter((m) => fold(m.name).includes(q)) : members;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Προσθήκη μέλους</SheetTitle>
        <SheetDescription>{label(cls)}</SheetDescription>
      </SheetHeader>

      <div className="px-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Αναζήτηση μέλους"
          aria-label="Αναζήτηση μέλους"
        />
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
        {matches.length === 0 ? (
          <li className="text-muted-foreground text-sm">Κανένα μέλος.</li>
        ) : (
          matches.map((m) => (
            <li key={m.id}>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onPick(m)}
              >
                {m.name}
              </Button>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
