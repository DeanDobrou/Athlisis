"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Shapes,
  Tags,
  Users,
} from "lucide-react";

import { logout } from "@/app/actions/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// Grouped by how often staff touch a screen, not by how the tables relate.
// The overview is the landing page, so it sits alone above everything. The
// two setup screens moved to the bottom: they are filled in once and then
// left, and sitting in the middle they split the two screens that are used
// together all day. An empty label means the group renders without a heading.
const nav = [
  {
    label: "",
    items: [
      { title: "Με μια ματιά", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Προπόνηση",
    items: [
      { title: "Πρόγραμμα", href: "/schedule", icon: CalendarDays },
      { title: "WODs", href: "/wods", icon: Dumbbell },
    ],
  },
  {
    label: "Μέλη",
    items: [
      { title: "Μέλη", href: "/members", icon: Users },
      { title: "Συνδρομές", href: "/memberships", icon: CreditCard },
    ],
  },
  {
    label: "Ρυθμίσεις",
    items: [
      { title: "Πακέτα", href: "/plans", icon: Tags },
      { title: "Τύποι μαθημάτων", href: "/class-types", icon: Shapes },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 font-heading text-xl font-semibold tracking-wide">
        Athlisis
      </SidebarHeader>
      <SidebarContent className="font-heading">
        {nav.map((group) => (
          <SidebarGroup key={group.label || "overview"}>
            {group.label && (
              <SidebarGroupLabel className="tracking-wider uppercase">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      // Exact, or a child route. A bare startsWith lit up
                      // Members on /memberships, since that is a prefix.
                      isActive={
                        pathname === item.href ||
                        pathname.startsWith(`${item.href}/`)
                      }
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="font-heading">
        <SidebarMenu>
          <SidebarMenuItem>
            <form action={logout}>
              <SidebarMenuButton type="submit" className="w-full">
                <LogOut />
                <span>Αποσύνδεση</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
