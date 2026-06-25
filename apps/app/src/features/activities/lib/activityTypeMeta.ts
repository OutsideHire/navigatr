/**
 * activityTypeMeta — shared icon / accent / label maps for the four activity
 * types, so every surface that renders an activity (the Activities History
 * tab and the deal-detail Activity log) presents types identically.
 */
import { Calendar, Mail, MapPin, Phone, type LucideIcon } from "lucide-react";
import type { ActivityType } from "../mockData";

export const ACTIVITY_TYPE_ICON: Record<ActivityType, LucideIcon> = {
  call: Phone,
  email: Mail,
  drop_in: MapPin,
  appointment: Calendar,
};

export const ACTIVITY_TYPE_ACCENT: Record<ActivityType, { bg: string; fg: string }> = {
  call: { bg: "bg-accent-teal-20", fg: "text-accent-teal" },
  email: { bg: "bg-accent-blue-20", fg: "text-accent-blue" },
  drop_in: { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  appointment: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
};

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  drop_in: "Drop-in",
  appointment: "Appointment",
};
