import "server-only";
import { serviceClient } from "@/lib/supabase/service";

export type PublicEvent = {
  name: string;
  slug: string;
  helpLocation: string | null;
};

/**
 * The event the public pages describe: the newest, as the organizer screens
 * and the check-in form pick it. Read with the service role because
 * anonymous visitors can't read events; only these three fields leave.
 */
export async function loadPublicEvent(): Promise<PublicEvent | null> {
  const { data, error } = await serviceClient()
    .from("events")
    .select("name, slug, help_location")
    .order("year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`events: ${error.message}`);
  return data
    ? { name: data.name, slug: data.slug, helpLocation: data.help_location }
    : null;
}
