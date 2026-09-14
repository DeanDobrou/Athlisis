import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Toaster } from "@/components/toaster";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* min-w-0 lets a wide page, like the bookings board, scroll inside its
          own box instead of stretching the whole layout past the screen. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Breadcrumbs />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
