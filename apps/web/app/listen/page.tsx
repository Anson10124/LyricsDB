import type { Metadata } from "next";
import { ListenView } from "@/components/listen/listen-view";

export const metadata: Metadata = {
  title: "Listen · LyricsDB",
  description:
    "Recognise the song that's playing around you and follow its synced lyrics.",
};

export default function ListenPage() {
  return <ListenView />;
}
