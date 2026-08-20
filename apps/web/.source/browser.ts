// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"api-overview.mdx": () => import("../content/docs/api-overview.mdx?collection=docs"), "formats.mdx": () => import("../content/docs/formats.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "quickstart.mdx": () => import("../content/docs/quickstart.mdx?collection=docs"), "streaming.mdx": () => import("../content/docs/streaming.mdx?collection=docs"), "supported-platforms.mdx": () => import("../content/docs/supported-platforms.mdx?collection=docs"), "tracks/getTrack.mdx": () => import("../content/docs/tracks/getTrack.mdx?collection=docs"), "tracks/getTrackById.mdx": () => import("../content/docs/tracks/getTrackById.mdx?collection=docs"), "tracks/postTrack.mdx": () => import("../content/docs/tracks/postTrack.mdx?collection=docs"), "tracks/searchTracks.mdx": () => import("../content/docs/tracks/searchTracks.mdx?collection=docs"), "lyrics/getLyrics.mdx": () => import("../content/docs/lyrics/getLyrics.mdx?collection=docs"), "lyrics/getLyricsById.mdx": () => import("../content/docs/lyrics/getLyricsById.mdx?collection=docs"), "lyrics/streamLyrics.mdx": () => import("../content/docs/lyrics/streamLyrics.mdx?collection=docs"), }),
};
export default browserCollections;