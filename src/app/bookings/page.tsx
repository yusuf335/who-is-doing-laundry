import { redirect } from "next/navigation";

/** Bookings now live on the Today screen; old links and home-screen shortcuts land there. */
export default function BookingsPage() {
  redirect("/");
}
