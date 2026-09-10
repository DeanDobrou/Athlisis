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
import { Plus } from "lucide-react";
import {
  Fragment,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  bookMemberAction,
  cancelBookingAction,
  moveBookingAction,
} from "@/app/actions/bookings";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

type Member = { id: string; name: string };

type Change =
  | { type: "move"; bookingId: string; to: string }
  | { type: "remove"; bookingId: string };

type Message = {
  text: string;
  tone: "error" | "info";
  /** A move can be taken back: this booking returns to this class. */
  undo?: { bookingId: string; to: string };
};

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
 * they were, with the reason shown. The rules checked here are only the ones
 * the board can see; lib/bookings.ts decides, including whether the paying
 * membership covers the new day.
 *
 * ponytail: every class is assumed to start on one of SLOTS - the schedule
 * form only offers those, and all current classes do. A class at any other
 * time would have no row; add a row for strays if slots ever stop being fixed.
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
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<WeekBooking | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // A drag that ends on its own chip can still fire a click. This swallows
  // that one click so finishing a drag never asks to cancel.
  const justDragged = useRef(false);

  // Mouse drags start after a few pixels, so a click stays a click. Touch
  // drags start after a short press, so a tap stays a tap and a swipe still
  // scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const inClass = (classId: string) =>
    shown.filter((b) => b.session_id === classId);

  /** Why this booking cannot go to that class, as far as the board can tell. */
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

  function move(booking: WeekBooking, target: ClassSession, offerUndo = true) {
    if (target.id === booking.session_id) return;
    const why = refusal(booking, target);
    if (why) {
      setMessage({ text: why, tone: "error" });
      return;
    }
    const from = booking.session_id;
    startTransition(async () => {
      applyChange({ type: "move", bookingId: booking.id, to: target.id });
      const result = await moveBookingAction(booking.id, target.id);
      if ("error" in result) {
        setMessage({ text: result.error, tone: "error" });
        return;
      }
      setMessage({
        text: `${booking.member_name}: ${label(target)}`,
        tone: "info",
        undo: offerUndo ? { bookingId: booking.id, to: from } : undefined,
      });
    });
  }

  function undo() {
    const back = message?.undo;
    setMessage(null);
    if (!back) return;
    const booking = shown.find((b) => b.id === back.bookingId);
    const target = classById.get(back.to);
    if (booking && target) move(booking, target, false);
  }

  function cancel(booking: WeekBooking) {
    const cls = classById.get(booking.session_id);
    const where = cls ? `, ${label(cls)}` : "";
    if (!confirm(`Ακύρωση της κράτησης για ${booking.member_name}${where};`)) {
      return;
    }
    startTransition(async () => {
      applyChange({ type: "remove", bookingId: booking.id });
      const result = await cancelBookingAction(booking.id);
      setMessage(
        "error" in result
          ? { text: result.error, tone: "error" }
          : {
              text: `Η κράτηση για ${booking.member_name} ακυρώθηκε.`,
              tone: "info",
            },
      );
    });
  }

  function add(member: Member, target: ClassSession) {
    setAddingTo(null);
    startTransition(async () => {
      const result = await bookMemberAction(member.id, target.id);
      setMessage(
        "error" in result
          ? { text: result.error, tone: "error" }
          : {
              text: result.notice ?? `${member.name}: ${label(target)}`,
              tone: "info",
            },
      );
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
    cancel(booking);
  }

  const addClass = addingTo ? classById.get(addingTo) : undefined;

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
              gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(10rem, 1fr))`,
            }}
          >
            <div />
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
                  {formatDate(day).slice(0, 5)}
                </span>
              </div>
            ))}

            {SLOTS.map((slot) => (
              <Fragment key={slot.start}>
                <div className="text-muted-foreground pt-2 text-xs tabular-nums">
                  {slot.start}
                </div>
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

      {(message || pending) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            role={message?.tone === "error" ? "alert" : "status"}
            className={cn(
              "bg-background pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-lg",
              message?.tone === "error" && "border-destructive/50 text-destructive",
            )}
          >
            <span>{message?.text ?? "Αποθήκευση..."}</span>
            {message?.undo && (
              <Button type="button" size="sm" variant="outline" onClick={undo}>
                Αναίρεση
              </Button>
            )}
          </div>
        </div>
      )}
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

      {!cancelled && count < cls.capacity && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mt-1 self-start"
          onClick={onAdd}
          aria-label={`Προσθήκη μέλους, ${label(cls)}`}
          title="Προσθήκη μέλους"
        >
          <Plus />
        </Button>
      )}
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
  // Only a booking that has not happened yet can be moved or cancelled.
  // Checked-in and no-show stay put: they are attendance, not a plan.
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
        // A plain button, not a menu trigger: the app's Base UI menus open on
        // mouse-down, which would fire at the start of every drag.
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
        <span className="text-muted-foreground ml-auto">Check-in</span>
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
